/* Markdown only: raw HTML is displayed as text, never promoted into app controls. */
(() => {
  'use strict';
  // Marked uses Array.at; Android 11's stock WebView 83 predates this API.
  if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', {
    configurable:true, writable:true,
    value:function at(index) {
      if (this == null) throw new TypeError('Array.at requires a value');
      const object = Object(this), length = Math.min(Math.max(Math.trunc(+object.length) || 0, 0), Number.MAX_SAFE_INTEGER);
      let offset = Math.trunc(+index) || 0;
      if (offset < 0) offset += length;
      return offset < 0 || offset >= length ? undefined : object[offset];
    },
  });
  const escape = text => String(text || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const renderer = {
    html(token) { return escape(token.text); },
    image(token) { return `<span>[图片：${escape(token.text)}]</span>`; },
    link(token) {
      const label = this.parser.parseInline(token.tokens);
      // Local documents open through the Android file surface, never in the app WebView.
      const local = token.href && !token.href.startsWith('#') && (!/^[a-z][a-z\d+.-]*:/i.test(token.href) || /^file:/i.test(token.href)) && !token.href.startsWith('//');
      if (local) return `<a href="#" data-workspace-file="${escape(token.href)}">${label}</a>`;
      if (!/^(https?:\/\/|mailto:|#)/i.test(token.href)) return label;
      return `<a href="${escape(token.href)}"${token.title ? ` title="${escape(token.title)}"` : ''}>${label}</a>`;
    },
  };
  marked.use({renderer});
  window.KaipiRender = {markdown:text => {
    const plain = String(text || '');
    try { return marked.parse(plain, {breaks:true,gfm:true}); }
    // A display failure must never interrupt request acknowledgement or queue scheduling.
    catch { return `<p>${escape(plain).replace(/\r?\n/g, '<br>')}</p>`; }
  }};
})();
