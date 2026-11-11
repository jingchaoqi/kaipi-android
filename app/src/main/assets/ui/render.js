/* Markdown only: raw HTML is displayed as text, never promoted into app controls. */
(() => {
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
  window.KaipiRender = {markdown:text => marked.parse(String(text || ''), {breaks:true,gfm:true})};
})();
