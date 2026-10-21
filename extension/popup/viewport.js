/** Set native popup sizing before styles paint; previews keep their host width. */
(function setPopupContext() {
  if (location.protocol === 'chrome-extension:' && window === window.top) {
    document.documentElement.dataset.popupWindow = 'true';
  }
})();
