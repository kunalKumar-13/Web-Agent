/**
 * Barrel: the seven composable browser tools.
 *   open_browser, navigate_to_url, take_screenshot,
 *   click_on_screen(x, y), send_keys, scroll, double_click
 * The agent builds all behaviour by sequencing these primitives.
 */
export { openBrowser, closeBrowser, BrowserSession, OpenBrowserOptions } from './browser';
export { navigateToUrl } from './navigation';
export { takeScreenshot } from './screenshot';
export { clickOnScreen, doubleClick } from './mouse';
export { sendKeys, pressKey } from './keyboard';
export { scroll } from './scroll';
