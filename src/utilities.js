import {updateOverrideContext} from 'aurelia-templating-resources/repeat-utilities';

export function calcOuterHeight(element: Element): number {
  let height;
  height = element.getBoundingClientRect().height;
  height += getStyleValue(element, 'marginTop');
  height += getStyleValue(element, 'marginBottom');
  return height;
}

export function insertBeforeNode(view: View, bottomBuffer: number): void {
  let viewStart = view.firstChild;
  let element = viewStart.nextSibling;
  let viewEnd = view.lastChild;
  let parentElement = bottomBuffer.parentElement;

  parentElement.insertBefore(viewEnd, bottomBuffer);
  parentElement.insertBefore(element, viewEnd);
  parentElement.insertBefore(viewStart, element);
}

/**
* Update the override context.
* @param startIndex index in collection where to start updating.
*/
export function updateVirtualOverrideContexts(repeat: VirtualRepeat, startIndex: number): void {
  let views = repeat.viewSlot.children;
  let viewLength = views.length;
  let collectionLength = repeat.items.length;

  if (startIndex > 0) {
    startIndex = startIndex - 1;
  }

  let delta = repeat._topBufferHeight / repeat.itemHeight;

  for (; startIndex < viewLength; ++startIndex) {
    updateOverrideContext(views[startIndex].overrideContext, startIndex + delta, collectionLength);
  }
}

export function rebindAndMoveView(repeat: VirtualRepeat, view: View, index: number, moveToBottom: boolean): void {
  let items = repeat.items;
  let viewSlot = repeat.viewSlot;
  updateOverrideContext(view.overrideContext, index, items.length);
  view.bindingContext[repeat.local] = items[index];
  if (moveToBottom) {
    viewSlot.children.push(viewSlot.children.shift());
    repeat.viewStrategy.moveViewLast(view, repeat.bottomBuffer);
  } else {
    viewSlot.children.unshift(viewSlot.children.splice(-1, 1)[0]);
    repeat.viewStrategy.moveViewFirst(view, repeat.topBuffer);
  }
}

export function getStyleValue(element: Element, style: string): any {
  let currentStyle;
  let styleValue;
  currentStyle = element.currentStyle || window.getComputedStyle(element);
  styleValue = parseInt(currentStyle[style], 10);
  return Number.isNaN(styleValue) ? 0 : styleValue;
}

export function getElementDistanceToBottomViewPort(element: Element): number {
  return document.documentElement.clientHeight - element.getBoundingClientRect().bottom;
}

export function getElementDistanceToTopViewPort(element: Element): number {
  return element.getBoundingClientRect().top;
}
