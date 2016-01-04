/* global content, addMessageListener */
(function (msgMgr) {
"use strict";

//const Cc = Components.classes;
const Ci = Components.interfaces;
//const Cu = Components.utils;

const isChrome = typeof window === "object";

addEventListener("find", function (evt) {
	dump(">>> find event: " + evt.detail.query + "\n");								// debug
}, true);

//* {Object} Mapping from base letters to variants with more diacritics.
const charsByBase = {
	a: "àảãáạăằẳẵắặâầẩẫấậ", "ă": "ằẳẵắặ", "â": "ầẩẫấậ",
	"à": "ằầ", "ả": "ẳẩ", "ã": "ẵẫ", "á": "ắấ", "ạ": "ặậ",
	d: "đ₫",
	"đ": "₫",
	e: "èẻẽéẹêềểễếệ", "ê": "ềểễếệ",
	"è": "ề", "ẻ": "ể", "ẽ": "ễ", "é": "ế", "ẹ": "ệ",
	g: "\u0303",
	i: "ìỉĩíị",
	o: "òỏõóọôồổỗốộơờởỡớợ", "ô": "ồổỗốộ", "ơ": "ờởỡớợ",
	"ò": "ồờ", "ỏ": "ổở", "õ": "ỗỡ", "ó": "ốớ", "ọ": "ộợ",
	u: "ùủũúụưừửữứự", "ư": "ừửữứự",
	"ù": "ùừ", "ủ": "ủử", "ũ": "ũữ", "ú": "úứ", "ụ": "ụự",
	y: "ỳỷỹýỵ",
};

/**
 * {RegExp} Regular expression matching a consecutive run of a foldable
 * character.
 */
const baseRunPattern = (function () {
	let branches = [];
	for (let base in charsByBase) {
		if (charsByBase.propertyIsEnumerable(base)) {
			branches.push(base + "+", base.toUpperCase() + "+");
		}
	}
	return new RegExp(branches.join("|"), "g");
})();

/**
 * Returns the top-level selection controller for the given window.
 *
 * Based on Finder#_getSelectionController in
 * <https://dxr.mozilla.org/mozilla-central/source/toolkit/modules/Finder.jsm#662>.
 */
function getSelectionController(win) {
	try {
		if (!win.innerWidth || !win.innerHeight) return null;
	}
	catch (exc) {
		return null;
	}
	let docShell = win.QueryInterface(Ci.nsIInterfaceRequestor)
		.getInterface(Ci.nsIWebNavigation)
		.QueryInterface(Ci.nsIDocShell);
	let controller = docShell.QueryInterface(Ci.nsIInterfaceRequestor)
		.getInterface(Ci.nsISelectionDisplay)
		.QueryInterface(Ci.nsISelectionController);
	return controller;
}

/**
 * Returns a regular expression that matches the given string plus any
 * variations with more (but not fewer) Vietnamese diacritics. Also normalizes
 * the query string per the special cases in nsFind::Find().
 *
 * @param {String} Query string.
 * @param {Boolean} True to distinguish between uppercase and lowercase.
 * @returns {RegExp} A diacritic-folded representation of the query string.
 * @see #getNormalizedContent
 */
function getFoldPattern(query, caseSensitive) {
	let src = query.replace(baseRunPattern, function (base, offset, whole) {
		let chars = base[0].toLowerCase();
		chars += charsByBase[chars];
		if (base[0] === base[0].toUpperCase()) chars = chars.toUpperCase();
		let pattern = "[" + chars + "]";
		if (base.length > 1) pattern += "{" + base.length + "}";
		return pattern;
	}).replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
	return new RegExp(src, caseSensitive ? "g" : "gi");
}

/**
 * Returns the given text node’s contents, normalized per the special cases in
 * nsFind::Find().
 *
 * @param {Text} Text node to get the contents of.
 * @returns {String} Normalized contents of the text node.
 * @see #getFoldPattern
 */
function getNormalizedContent(node) {
	// Includes some special cases from nsFind::Find().
	if (!node.data) return "";
	return node.data.replace(/\u00ad/g /* shy */, "").replace(/\s/g, " ")
		.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
}

/**
 * Returns a node iterator over the text fields or matching text nodes within
 * the given root element.
 * 
 * @param {Element} rootElt Root element to traverse.
 * @param {RegExp} pattern Regular expression for filtering text nodes by.
 * @param {Boolean} showTxt True to traverse text and element nodes; false to
 * 	only traverse element nodes.
 * @returns {NodeIterator} Node iterator for finding the given pattern.
 */
function getNodeIterator(win, rootElt, pattern, showTxt) {
	let doc = win.document;
	const NF = win.NodeFilter;
	/* jshint bitwise: false */
	let whatToShow = NF.SHOW_ELEMENT;
	if (showTxt) whatToShow |= NF.SHOW_TEXT;
	/* jshint bitwise: true */
	return doc.createNodeIterator(rootElt, whatToShow, function (node) {
		// #text
		if (node.nodeType === 3) {
			return pattern.test(getNormalizedContent(node)) ? NF.FILTER_ACCEPT :
				NF.FILTER_REJECT;
		}
		// <frame>, <iframe>, <object>
		if ("contentDocument" in node) return NF.FILTER_ACCEPT;
		// <input type="text"> etc.
		if ("mozIsTextField" in node) {
			return node.mozIsTextField(true /* no passwords */) ?
				NF.FILTER_ACCEPT : NF.FILTER_REJECT;
		}
		// <textarea>
		return (node instanceof win.HTMLTextAreaElement) ? NF.FILTER_ACCEPT :
			NF.FILTER_REJECT;
	});
}

/**
 * Returns the nsIEditor (or subclass) instance associated with the given
 * element.
 *
 * @param {Element} elt The XUL or HTML element.
 * @returns	{nsIEditor} The nsIEditor instance hosted by the given element.
 */
function getEditor(elt) {
	try {
		return elt && elt.QueryInterface(Ci.nsIDOMNSEditableElement).editor;
	}
	catch (e) {}
	try {
		return elt.QueryInterface(Ci.nsIEditor).editor;
	}
	catch (e) {}
	try {
		// http://osdir.com/ml/mozilla.devel.editor/2004-10/msg00017.html
		let webNavigation = elt.QueryInterface(Ci.nsIInterfaceRequestor)
			.getInterface(Ci.nsIWebNavigation);
		let editingSession = webNavigation
			.QueryInterface(Ci.nsIInterfaceRequestor)
			.getInterface(Ci.nsIEditingSession);
		return editingSession.getEditorForWindow(elt);
	}
	catch (e) {}
	return null;
}

/**
 * Visits each matching text node in the given root element and any editors
 * associated with its descendant elements.
 *
 * @param {RegExp} pattern Regular expression for filtering text nodes by.
 * @param {Element} rootElt Root element to traverse.
 * @param {Function?(Selection) => Boolean?} onEditor Function to call each time
 * 	a new editor is encountered. Return the literal |false| to stop the
 * 	traversal.
 * @param {Function?(Selection, Range) => Boolean?} onResult Function to call
 * 	each time a node matches. Return the literal |false| to stop the traversal.
 * @param {Boolean} True if the entire root element was traversed.
 */
function findAll(win, sel, pattern, rootElt, onEditor, onResult) {
	if (!rootElt || !sel) return true;
	
	let iter = getNodeIterator(win, rootElt, pattern, onResult);
	let node;
	while ((node = iter.nextNode())) {
		if (node.nodeType === 1) {
			let editor;
			let rootElt;
			let childSel = sel;
			// <input>, <textarea>, Midas
			if ((editor = getEditor(node.contentWindow || node))) {
				rootElt = editor.rootElement;
				childSel = editor.selectionController
					.getSelection(Ci.nsISelectionController.SELECTION_FIND);
				if (onEditor && onEditor(childSel) === false) return false;
			}
			// <frame>, <iframe>, <object>
			else if ("contentDocument" in node) rootElt = node.contentDocument;
			
			if (findAll(win, childSel, pattern, rootElt, onEditor, onResult) ===
				false) {
				return false;
			}
		}
		// #text
		else if (onResult) {
			pattern.lastIndex = 0;
			let result;
			while ((result = pattern.exec(getNormalizedContent(node)))) {
				let range = win.document.createRange();
				range.setStart(node, result.index);
				range.setEnd(node, result.index + result[0].length);
				if (onResult(sel, range) === false) return false;
			}
		}
	}
	return true;
}

/**
 * Highlights all matches in the document according to the given options.
 *
 * @param {Object} Serialized find event object.
 */
function onHighlightAllChange(options) {
	let query = options.query;
	let controller = getSelectionController(isChrome ? window : content);
	// TODO: Editable node listeners
	// _getEditableNode: https://dxr.mozilla.org/mozilla-central/source/toolkit/modules/Finder.jsm#693
	let sel = controller &&
		controller.getSelection(Ci.nsISelectionController.SELECTION_FIND);
	if (!sel) return;
	
	let win = isChrome ? window : content;
	let doc = win.document;
	
	let foldPattern = getFoldPattern(query, options.caseSensitive);
	sel.removeAllRanges();
	findAll(win, sel, foldPattern, doc.documentElement, function (sel) {
		sel.removeAllRanges();
	}, options.highlightAll && function (sel, range) {
		sel.addRange(range);
	});
}

addMessageListener("AVIM:findhighlightallchange", function (msg) {
	// msg.name
	onHighlightAllChange(msg.data);
}, true);

})(this);
