import {inject} from 'aurelia-dependency-injection';
import {ObserverLocator} from 'aurelia-binding';
import {
  BoundViewFactory,
  ViewSlot,
  ViewResources,
  TargetInstruction,
  customAttribute,
  bindable,
  templateController
} from 'aurelia-templating';
import {AbstractRepeater} from 'aurelia-templating-resources';
import {
  getItemsSourceExpression,
  isOneTime,
  unwrapExpression,
  updateOneTimeBinding
} from 'aurelia-templating-resources/repeat-utilities';
import {viewsRequireLifecycle} from 'aurelia-templating-resources/analyze-view-factory';
import {DOM} from 'aurelia-pal';
import {
  getStyleValue,
  calcOuterHeight,
  rebindAndMoveView
} from './utilities';
import {DomHelper} from './dom-helper';
import {VirtualRepeatStrategyLocator} from './virtual-repeat-strategy-locator';
import {ViewStrategyLocator} from './view-strategy';

@customAttribute('virtual-repeat')
@templateController
@inject(DOM.Element, BoundViewFactory, TargetInstruction, ViewSlot, ViewResources, ObserverLocator, VirtualRepeatStrategyLocator, ViewStrategyLocator, DomHelper)
export class VirtualRepeat extends AbstractRepeater {
  _first = 0;
  _previousFirst = 0;
  _viewsLength = 0;
  _lastRebind = 0;
  _topBufferHeight = 0;
  _bottomBufferHeight = 0;
  _bufferSize = 5;
  _scrollingDown = false;
  _scrollingUp = false;
  _switchedDirection = false;
  _isAttached = false;
  _ticking = false;
  _fixedHeightContainer = false;
  _hasCalculatedSizes = false;
  _isAtTop = true;

  @bindable items
  @bindable local
  constructor(
    element: Element,
    viewFactory: BoundViewFactory,
    instruction: TargetInstruction,
    viewSlot: ViewSlot,
    viewResources: ViewResources,
    observerLocator: ObserverLocator,
    strategyLocator: VirtualRepeatStrategyLocator,
    viewStrategyLocator: ViewStrategyLocator,
    domHelper: DomHelper) {
    super({
      local: 'item',
      viewsRequireLifecycle: viewsRequireLifecycle(viewFactory)
    });

    this.element = element;
    this.viewFactory = viewFactory;
    this.instruction = instruction;
    this.viewSlot = viewSlot;
    this.lookupFunctions = viewResources.lookupFunctions;
    this.observerLocator = observerLocator;
    this.strategyLocator = strategyLocator;
    this.viewStrategyLocator = viewStrategyLocator;
    this.sourceExpression = getItemsSourceExpression(this.instruction, 'virtual-repeat.for');
    this.isOneTime = isOneTime(this.sourceExpression);
    this.domHelper = domHelper;
  }

  attached(): void {
    this._isAttached = true;
    let element = this.element;
    this._itemsLength = this.items.length;
    this.viewStrategy = this.viewStrategyLocator.getStrategy(element);
    this.scrollContainer = this.viewStrategy.getScrollContainer(element);
    this.topBuffer = this.viewStrategy.createTopBufferElement(element);
    this.bottomBuffer = this.viewStrategy.createBottomBufferElement(element);
    this.itemsChanged();
    this.scrollListener = () => this._onScroll();

    this.calcDistanceToTopInterval = setInterval(() => {
      let distanceToTop = this.distanceToTop;
      this.distanceToTop = this.domHelper.getElementDistanceToTopOfDocument(this.topBuffer);
      if (distanceToTop !== this.distanceToTop) {
        this._handleScroll();
      }
    }, 500);

    this.distanceToTop = this.domHelper.getElementDistanceToTopOfDocument(this.viewStrategy.getFirstElement(this.topBuffer));
    if (this.domHelper.hasOverflowScroll(this.scrollContainer)) {
      this._fixedHeightContainer = true;
      this.scrollContainer.addEventListener('scroll', this.scrollListener);
    } else {
      document.addEventListener('scroll', this.scrollListener);
    }
  }

  bind(bindingContext, overrideContext): void {
    this.scope = { bindingContext, overrideContext };
  }

  call(context, changes): void {
    this[context](this.items, changes);
  }

  detached(): void {
    this.scrollContainer.removeEventListener('scroll', this.scrollListener);
    this._first = 0;
    this._previousFirst = 0;
    this._viewsLength = 0;
    this._lastRebind = 0;
    this._topBufferHeight = 0;
    this._bottomBufferHeight = 0;
    this._scrollingDown = false;
    this._scrollingUp = false;
    this._switchedDirection = false;
    this._isAttached = false;
    this._ticking = false;
    this._hasCalculatedSizes = false;
    this.viewStrategy.removeBufferElements(this.element, this.topBuffer, this.bottomBuffer);
    this.isLastIndex = false;
    this.scrollContainer = null;
    this.scrollContainerHeight = null;
    this.distanceToTop = null;
    this.removeAllViews(true);
    if (this.scrollHandler) {
      this.scrollHandler.dispose();
    }
    this._unsubscribeCollection();
    clearInterval(this.calcDistanceToTopInterval);
  }

  itemsChanged(): void {
    this._unsubscribeCollection();
    // still bound?
    if (!this.scope) {
      return;
    }
    let items = this.items;
    this.strategy = this.strategyLocator.getStrategy(items);
    if (items.length > 0 && this.viewCount() === 0) {
      this.strategy.createFirstItem(this);
    }
    this._calcInitialHeights(items.length);
    if (!this.isOneTime && !this._observeInnerCollection()) {
      this._observeCollection();
    }

    this.strategy.instanceChanged(this, items, this._viewsLength);
  }

  unbind(): void {
    this.scope = null;
    this.items = null;
    this._itemsLength = null;
  }

  handleCollectionMutated(collection, changes): void {
    this._handlingMutations = true;
    this._itemsLength = collection.length;
    this.strategy.instanceMutated(this, collection, changes);
  }

  handleInnerCollectionMutated(collection, changes): void {
    // guard against source expressions that have observable side-effects that could
    // cause an infinite loop- eg a value converter that mutates the source array.
    if (this.ignoreMutation) {
      return;
    }
    this.ignoreMutation = true;
    let newItems = this.sourceExpression.evaluate(this.scope, this.lookupFunctions);
    this.observerLocator.taskQueue.queueMicroTask(() => this.ignoreMutation = false);

    // call itemsChanged...
    if (newItems === this.items) {
      // call itemsChanged directly.
      this.itemsChanged();
    } else {
      // call itemsChanged indirectly by assigning the new collection value to
      // the items property, which will trigger the self-subscriber to call itemsChanged.
      this.items = newItems;
    }
  }

  _onScroll(): void {
    if (!this._ticking && !this._handlingMutations) {
      requestAnimationFrame(() => this._handleScroll());
      this._ticking = true;
    }

    if (this._handlingMutations) {
      this._handlingMutations = false;
    }
  }

  _handleScroll(): void {
    if (!this._isAttached) {
      return;
    }
    let itemHeight = this.itemHeight;
    let scrollTop = this._fixedHeightContainer ? this.scrollContainer.scrollTop : pageYOffset - this.distanceToTop;
    this._first = Math.floor(scrollTop / itemHeight);
    this._first = this._first < 0 ? 0 : this._first;
    if (this._first > this.items.length - this.elementsInView) {
      this._first = this.items.length - this.elementsInView;
    }
    this._checkScrolling();
    // TODO if and else paths do almost same thing, refactor?
    if (this._scrollingDown) {
      let viewsToMove = this._first - this._lastRebind;
      if (this._switchedDirection) {
        viewsToMove = this._isAtTop ? this._first : this._bufferSize - (this._lastRebind - this._first);
      }
      this._isAtTop = false;
      this._lastRebind = this._first;
      let movedViewsCount = this._moveViews(viewsToMove);
      let adjustHeight = movedViewsCount < viewsToMove ? this._bottomBufferHeight : itemHeight * movedViewsCount;
      this._switchedDirection = false;
      this._topBufferHeight = this._topBufferHeight + adjustHeight;
      this._bottomBufferHeight = this._bottomBufferHeight - adjustHeight;
      if (this._bottomBufferHeight >= 0) {
        this._adjustBufferHeights();
      }
    } else if (this._scrollingUp) {
      let viewsToMove = this._lastRebind - this._first;
      if (this._switchedDirection) {
        if (this.isLastIndex) {
          viewsToMove = this.items.length - this._first - this.elementsInView;
        } else {
          viewsToMove = this._bufferSize - (this._first - this._lastRebind);
        }
      }
      this.isLastIndex = false;
      this._lastRebind = this._first;
      let movedViewsCount = this._moveViews(viewsToMove);
      this.movedViewsCount = movedViewsCount;
      let adjustHeight = movedViewsCount < viewsToMove ? this._topBufferHeight : itemHeight * movedViewsCount;
      this._switchedDirection = false;
      this._topBufferHeight = this._topBufferHeight - adjustHeight;
      this._bottomBufferHeight = this._bottomBufferHeight + adjustHeight;
      if (this._topBufferHeight >= 0) {
        this._adjustBufferHeights();
      }
    }
    this._previousFirst = this._first;

    this._ticking = false;
  }

  _checkScrolling(): void {
    if (this._first > this._previousFirst && (this._bottomBufferHeight > 0 || !this.isLastIndex)) {
      if (!this._scrollingDown) {
        this._scrollingDown = true;
        this._scrollingUp = false;
        this._switchedDirection = true;
      } else {
        this._switchedDirection = false;
      }
      this._isScrolling = true;
    } else if (this._first < this._previousFirst && (this._topBufferHeight >= 0 || !this._isAtTop)) {
      if (!this._scrollingUp) {
        this._scrollingDown = false;
        this._scrollingUp = true;
        this._switchedDirection = true;
      } else {
        this._switchedDirection = false;
      }
      this._isScrolling = true;
    } else {
      this._isScrolling = false;
    }
  }

  _adjustBufferHeights(): void {
    this.topBuffer.style.height = `${this._topBufferHeight}px`;
    this.bottomBuffer.style.height = `${this._bottomBufferHeight}px`;
  }

  _unsubscribeCollection(): void {
    if (this.collectionObserver) {
      this.collectionObserver.unsubscribe(this.callContext, this);
      this.collectionObserver = null;
      this.callContext = null;
    }
  }

  _moveViews(length: number): number {
    let getNextIndex = this._scrollingDown ? (index, i) =>  index + i : (index, i) =>  index - i;
    let isAtFirstOrLastIndex = () => this._scrollingDown ? this.isLastIndex : this._isAtTop;
    let childrenLength = this.viewCount();
    let viewIndex = this._scrollingDown ? 0 : childrenLength - 1;
    let items = this.items;
    let index = this._scrollingDown ? this._getIndexOfLastView() + 1 : this._getIndexOfFirstView() - 1;
    let i = 0;
    let viewToMoveLimit = length - (childrenLength * 2);
    while (i < length && !isAtFirstOrLastIndex()) {
      let view = this.view(viewIndex);
      let nextIndex = getNextIndex(index, i);
      this.isLastIndex = nextIndex >= items.length - 1;
      this._isAtTop = nextIndex <= 0;
      if (!(isAtFirstOrLastIndex() && childrenLength >= items.length)) {
        if (i > viewToMoveLimit) {
          rebindAndMoveView(this, view, nextIndex, this._scrollingDown);
        }
        i++;
      }
    }
    return length - (length - i);
  }

  _getIndexOfLastView(): number {
    return this.view(this.viewCount() - 1).overrideContext.$index;
  }

  _getIndexOfFirstView(): number {
    return this.view(0) ? this.view(0).overrideContext.$index : -1;
  }

  _calcInitialHeights(itemsLength: number) {
    if (this._viewsLength > 0 && this._itemsLength === itemsLength || itemsLength <= 0) {
      return;
    }
    this._hasCalculatedSizes = true;
    this._itemsLength = itemsLength;
    let firstViewElement = DOM.nextElementSibling(this.view(0).firstChild);
    this.itemHeight = calcOuterHeight(firstViewElement);
    if (this.itemHeight <= 0) {
      throw new Error('Could not calculate item height');
    }
    this.scrollContainerHeight = this._fixedHeightContainer ? this._calcScrollHeight(this.scrollContainer) : document.documentElement.clientHeight;
    this.elementsInView = Math.ceil(this.scrollContainerHeight / this.itemHeight) + 1;
    this._viewsLength = (this.elementsInView * 2) + this._bufferSize;
    this._bottomBufferHeight = this.itemHeight * itemsLength - this.itemHeight * this._viewsLength;
    if (this._bottomBufferHeight < 0) {
      this._bottomBufferHeight = 0;
    }
    this.bottomBuffer.style.height = `${this._bottomBufferHeight}px`;
    this._topBufferHeight = 0;
    this.topBuffer.style.height = `${this._topBufferHeight}px`;
    // TODO This will cause scrolling back to top when swapping collection instances that have different lengths - instead should keep the scroll position
    this.scrollContainer.scrollTop = 0;
    this._first = 0;
  }

  _calcScrollHeight(element: Element): number {
    let height;
    height = element.getBoundingClientRect().height;
    height -= getStyleValue(element, 'borderTopWidth');
    height -= getStyleValue(element, 'borderBottomWidth');
    return height;
  }

  _observeInnerCollection(): boolean {
    let items = this._getInnerCollection();
    let strategy = this.strategyLocator.getStrategy(items);
    if (!strategy) {
      return false;
    }
    this.collectionObserver = strategy.getCollectionObserver(this.observerLocator, items);
    if (!this.collectionObserver) {
      return false;
    }
    this.callContext = 'handleInnerCollectionMutated';
    this.collectionObserver.subscribe(this.callContext, this);
    return true;
  }

  _getInnerCollection(): any {
    let expression = unwrapExpression(this.sourceExpression);
    if (!expression) {
      return null;
    }
    return expression.evaluate(this.scope, null);
  }

  _observeCollection(): void {
    let items = this.items;
    this.collectionObserver = this.strategy.getCollectionObserver(this.observerLocator, items);
    if (this.collectionObserver) {
      this.callContext = 'handleCollectionMutated';
      this.collectionObserver.subscribe(this.callContext, this);
    }
  }

  // @override AbstractRepeater
  viewCount() { return this.viewSlot.children.length; }
  views() { return this.viewSlot.children; }
  view(index) { return this.viewSlot.children[index]; }

  addView(bindingContext, overrideContext) {
    let view = this.viewFactory.create();
    view.bind(bindingContext, overrideContext);
    this.viewSlot.add(view);
  }

  insertView(index, bindingContext, overrideContext) {
    let view = this.viewFactory.create();
    view.bind(bindingContext, overrideContext);
    this.viewSlot.insert(index, view);
  }

  removeAllViews(returnToCache, skipAnimation) {
    return this.viewSlot.removeAll(returnToCache, skipAnimation);
  }

  removeView(index, returnToCache, skipAnimation) {
    return this.viewSlot.removeAt(index, returnToCache, skipAnimation);
  }

  updateBindings(view: View) {
    let j = view.bindings.length;
    while (j--) {
      updateOneTimeBinding(view.bindings[j]);
    }
    j = view.controllers.length;
    while (j--) {
      let k = view.controllers[j].boundProperties.length;
      while (k--) {
        let binding = view.controllers[j].boundProperties[k].binding;
        updateOneTimeBinding(binding);
      }
    }
  }
}
