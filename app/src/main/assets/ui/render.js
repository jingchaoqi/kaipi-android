/* Markdown only: raw HTML is displayed as text, never promoted into app controls. */
(() => {
  const escape = text => String(text || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const renderer = {
    html(token) { return escape(token.text); },
    image(token) { return `<span>[图片：${escape(token.text)}]</span>`; },
    link(token) {
      const label = this.parser.parseInline(token.tokens);
      // No executable schemes. The app copies links instead of navigating its WebView.
      if (!/^(https?:\/\/|mailto:|[./#])/i.test(token.href)) return label;
      return `<a href="${escape(token.href)}"${token.title ? ` title="${escape(token.title)}"` : ''}>${label}</a>`;
    },
  };
  marked.use({renderer});
  window.KaipiRender = {markdown:text => marked.parse(String(text || ''), {breaks:true,gfm:true})};
})();
