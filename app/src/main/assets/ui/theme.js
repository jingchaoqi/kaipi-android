/* Apply before first paint, then reconcile with the core's saved preferences. */
(() => {
  const modes = ['system','light','dark'], colors = ['forest','indigo','clay'];
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = {mode:'system',color:'forest'};
  try { preference = {...preference, ...JSON.parse(localStorage.getItem('kaipi.appearance') || '{}')}; } catch { }
  function apply(value = preference) {
    preference = {mode:modes.includes(value.mode) ? value.mode : 'system', color:colors.includes(value.color) ? value.color : 'forest'};
    const dark = preference.mode === 'dark' || (preference.mode === 'system' && media.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.color = preference.color;
    try { localStorage.setItem('kaipi.appearance', JSON.stringify(preference)); } catch { }
    const backgrounds = dark ? {forest:'#171e19',indigo:'#181c26',clay:'#211c19'} : {forest:'#f8f9f6',indigo:'#f7f8fb',clay:'#faf7f3'};
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgrounds[preference.color]);
    if (window.Native?.appearance) Native.appearance(backgrounds[preference.color], dark);
    window.dispatchEvent(new CustomEvent('kaipi-theme', {detail:{...preference,dark}}));
    return preference;
  }
  if (media.addEventListener) media.addEventListener('change', () => apply());
  else media.addListener(() => apply());
  window.KaipiTheme = {apply, current:() => ({...preference})};
  apply();
})();
