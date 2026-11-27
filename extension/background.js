"use strict";

const YOUTUBE_URLS = [
  "*://youtube.com/*",
  "*://www.youtube.com/*",
  "*://m.youtube.com/*"
];

async function injectContentScript(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch (error) {
    // Tabs can disappear or start navigating between query and injection.
    // The manifest content script will run automatically on the next load.
    console.debug("Shorts Shadowban: deferred injection", error?.message || error);
  }
}

async function injectIntoOpenYouTubeTabs() {
  const tabs = await chrome.tabs.query({ url: YOUTUBE_URLS });
  await Promise.all(tabs.map((tab) => injectContentScript(tab.id)));
}

chrome.runtime.onInstalled.addListener(() => {
  void injectIntoOpenYouTubeTabs();
});

chrome.runtime.onStartup.addListener(() => {
  void injectIntoOpenYouTubeTabs();
});

// This also covers a YouTube tab whose URL changes without a full document
// reload. content.js guards against being initialized more than once.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url || "";
  if (/^https?:\/\/(?:www\.|m\.)?youtube\.com\//i.test(url)) {
    void injectContentScript(tabId);
  }
});
