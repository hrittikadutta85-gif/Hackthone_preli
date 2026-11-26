/* Shared by the server layout and the browser. */
export const LANG_KEY = "dengue-lang";

/**
 * Runs before the first paint. A returning Bangla reader would otherwise see a flash of the server's English page, so
 * the page stays hidden for the moment it takes React to switch (never longer than 2.5 seconds).
 */
export const LANG_BOOT_SCRIPT = `try{if(localStorage.getItem("${LANG_KEY}")==="bn"){var d=document.documentElement;d.lang="bn";d.dataset.langPending="";setTimeout(function(){delete d.dataset.langPending},2500)}}catch(e){}`;
