import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => undefined,
		removeListener: () => undefined,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
		dispatchEvent: () => false,
	}),
});

class ResizeObserverMock {
	observe() {
		return undefined;
	}

	unobserve() {
		return undefined;
	}

	disconnect() {
		return undefined;
	}
}

Object.defineProperty(globalThis, "ResizeObserver", {
	writable: true,
	value: ResizeObserverMock,
});

// jsdom doesn't implement scrollIntoView; Mantine Combobox calls it on highlight.
if (typeof (Element.prototype as any).scrollIntoView !== "function") {
	(Element.prototype as any).scrollIntoView = function scrollIntoView() {
		return undefined;
	};
}
