import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Language, literalTranslations, tokenTranslations } from "./translations";

const originalTextByNode = new WeakMap<Text, string>();

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  syncLanguagePreference: (language: unknown) => void;
  t: (text: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "platform_language";

const normalizeLanguage = (value: unknown): Language | null => {
  return value === "lt" || value === "en" ? value : null;
};

const translateText = (source: string, language: Language): string => {
  if (!source || language === "en") return source;
  const exact = literalTranslations[language][source];
  if (exact) return exact;

  let translated = source;
  for (const [pattern, replacement] of tokenTranslations[language]) {
    translated = translated.replace(pattern, replacement);
  }
  return translated;
};

const walkAndTranslateDom = (language: Language) => {
  const translateElementAttributes = (element: Element) => {
    if (!(element instanceof HTMLElement || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      return;
    }

    const attrNames = ["placeholder", "title", "aria-label"];
    for (const attrName of attrNames) {
      const originalKey = `data-i18n-original-${attrName}`;
      const currentValue = element.getAttribute(attrName);
      if (!currentValue) continue;

      if (!element.hasAttribute(originalKey)) {
        element.setAttribute(originalKey, currentValue);
      }
      const original = element.getAttribute(originalKey) || currentValue;
      element.setAttribute(attrName, translateText(original, language));
    }
  };

  const root = document.body;
  if (!root) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const parent = textNode.parentElement;
    if (!parent) continue;
    const raw = textNode.nodeValue || "";
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const knownOriginal = originalTextByNode.get(textNode);
    if (!knownOriginal) {
      originalTextByNode.set(textNode, raw);
    } else {
      const expectedCurrentValue = translateText(knownOriginal, language);
      if (raw !== expectedCurrentValue) {
        originalTextByNode.set(textNode, raw);
      }
    }

    const original = originalTextByNode.get(textNode) || raw;
    const translated = translateText(original, language);
    if (textNode.nodeValue !== translated) {
      textNode.nodeValue = translated;
    }
  }

  const elements = root.querySelectorAll("*");
  elements.forEach((element) => translateElementAttributes(element));
};

export const I18nProvider = ({ children }: { children: React.ReactNode }) => {
  const translatingRef = useRef(false);
  const frameRef = useRef<number | null>(null);

  const [language, setLanguageState] = useState<Language>(() => {
    const stored = normalizeLanguage(localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
    return "en";
  });

  const setLanguage = (nextLanguage: Language) => {
    if (nextLanguage === language) {
      localStorage.setItem(STORAGE_KEY, nextLanguage);
      return;
    }
    setLanguageState(nextLanguage);
    localStorage.setItem(STORAGE_KEY, nextLanguage);
  };

  const syncLanguagePreference = (candidate: unknown) => {
    const nextLanguage = normalizeLanguage(candidate);
    if (!nextLanguage) return;
    if (nextLanguage !== language) {
      setLanguageState(nextLanguage);
    }
    localStorage.setItem(STORAGE_KEY, nextLanguage);
  };

  useEffect(() => {
    document.documentElement.setAttribute("lang", language);
    const runTranslate = () => {
      if (translatingRef.current) return;
      translatingRef.current = true;
      try {
        walkAndTranslateDom(language);
      } finally {
        translatingRef.current = false;
      }
    };

    runTranslate();

    const observer = new MutationObserver(() => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        runTranslate();
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label"],
    });

    return () => {
      observer.disconnect();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [language]);

  const value = useMemo<I18nContextValue>(() => ({
    language,
    setLanguage,
    syncLanguagePreference,
    t: (text: string) => translateText(text, language),
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
};
