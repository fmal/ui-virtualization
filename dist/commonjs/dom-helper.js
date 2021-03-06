'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var DomHelper = exports.DomHelper = function () {
  function DomHelper() {
    _classCallCheck(this, DomHelper);
  }

  DomHelper.prototype.getElementDistanceToTopOfDocument = function getElementDistanceToTopOfDocument(element) {
    var box = element.getBoundingClientRect();
    var documentElement = document.documentElement;
    var scrollTop = window.pageYOffset;
    var clientTop = documentElement.clientTop;
    var top = box.top + scrollTop - clientTop;
    return Math.round(top);
  };

  DomHelper.prototype.hasOverflowScroll = function hasOverflowScroll(element) {
    var style = element.style;
    return style.overflowY === 'scroll' || style.overflow === 'scroll' || style.overflowY === 'auto' || style.overflow === 'auto';
  };

  return DomHelper;
}();