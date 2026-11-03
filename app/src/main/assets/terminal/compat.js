// Android 11's original WebView predates ParentNode.replaceChildren.
for (const type of [Element, DocumentFragment]) {
  if (!type.prototype.replaceChildren) {
    type.prototype.replaceChildren = function (...nodes) {
      this.textContent = '';
      this.append(...nodes);
    };
  }
}
