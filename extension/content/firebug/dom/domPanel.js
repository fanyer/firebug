/* See license.txt for terms of usage */
/*jshint esnext:true, es5:true, curly:false */
/*global FBTrace:true, XPCNativeWrapper:true, Window:true, define:true */

define([
    "firebug/firebug",
    "firebug/lib/trace",
    "firebug/lib/object",
    "firebug/lib/events",
    "firebug/lib/dom",
    "firebug/lib/css",
    "firebug/lib/search",
    "firebug/chrome/reps",
    "firebug/dom/domBasePanel",
    "firebug/dom/domModule",
],
function(Firebug, FBTrace, Obj, Events, Dom, Css, Search, FirebugReps, DOMBasePanel, DOMModule) {

// ********************************************************************************************* //
// Constants

var Trace = FBTrace.to("DBG_DOM");
var TraceError = FBTrace.to("DBG_ERRORS");

// ********************************************************************************************* //
// DOM Panel

/**
 * @panel This object represents a DOM panel in the main Firebug UI.
 */
function DOMPanel()
{
}

DOMPanel.DirTable = DOMBasePanel.prototype.dirTablePlate;
DOMPanel.prototype = Obj.extend(DOMBasePanel.prototype,
/** @lends DOMPanel */
{
    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // extends Panel

    name: "dom",
    searchable: true,
    statusSeparator: ">",
    enableA11y: true,
    deriveA11yFrom: "console",
    searchType : "dom",
    order: 50,
    inspectable: true,

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Initialization

    initialize: function()
    {
        this.onClick = Obj.bind(this.onClick, this);

        DOMModule.addListener(this);

        DOMBasePanel.prototype.initialize.apply(this, arguments);
    },

    destroy: function(state)
    {
        DOMModule.removeListener(this);

        DOMBasePanel.destroy.apply(this, arguments);
    },

    initializeNode: function(oldPanelNode)
    {
        Events.addEventListener(this.panelNode, "click", this.onClick, false);

        DOMBasePanel.prototype.initializeNode.apply(this, arguments);
    },

    destroyNode: function()
    {
        Events.removeEventListener(this.panelNode, "click", this.onClick, false);

        DOMBasePanel.prototype.destroyNode.apply(this, arguments);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Search

    search: function(text, reverse)
    {
        if (!text)
        {
            delete this.currentSearch;
            this.highlightNode(null);
            this.document.defaultView.getSelection().removeAllRanges();
            return false;
        }

        var row;
        if (this.currentSearch && text === this.currentSearch.text)
        {
            // xxxsz: 'Firebug.Search' is used here instead of 'Search' because we need to refer to
            // 'firebug/chrome/searchBox' and not to 'firebug/lib/search'
            // TODO: Rework 'searchBox.js', so it doesn't inject itself into the global 'Firebug'
            // scope anymore
            row = this.currentSearch.findNext(true, undefined, reverse,
                Firebug.Search.isCaseSensitive(text));
        }
        else
        {
            var findRow = function(node)
            {
                return Dom.getAncestorByClass(node, "memberRow");
            };

            this.currentSearch = new Search.TextSearch(this.panelNode, findRow);

            // xxxsz: 'Firebug.Search' is used here instead of 'Search' because we need to refer to
            // 'firebug/chrome/searchBox' and not to 'firebug/lib/search'
            row = this.currentSearch.find(text, reverse, Firebug.Search.isCaseSensitive(text));
        }

        if (row)
        {
            var sel = this.document.defaultView.getSelection();
            sel.removeAllRanges();
            sel.addRange(this.currentSearch.range);

            Dom.scrollIntoCenterView(row, this.panelNode);

            this.highlightNode(row);
            Events.dispatch(this.fbListeners, "onDomSearchMatchFound", [this, text, row]);
            return true;
        }
        else
        {
            this.document.defaultView.getSelection().removeAllRanges();
            Events.dispatch(this.fbListeners, "onDomSearchMatchFound", [this, text, null]);
            return false;
        }
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

    selectRow: function(row, target)
    {
        if (!target)
            target = row.lastChild.firstChild;

        var object = target && target.repObject, type = typeof object;
        if (!object || !this.supportsObject(object, type))
            return;

        this.pathToAppend = DOMBasePanel.getPath(row);

        // If the object is inside an array, look up its index
        var valueBox = row.lastChild.firstChild;
        if (Css.hasClass(valueBox, "objectBox-array"))
        {
            var arrayIndex = FirebugReps.Arr.getItemIndex(target);
            this.pathToAppend.push(arrayIndex);
        }

        // Make sure we get a fresh status path for the object, since otherwise
        // it might find the object in the existing path and not refresh it
        Firebug.chrome.clearStatusPath();

        this.select(object, true);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

    onClick: function(event)
    {
        var repNode = Firebug.getRepNode(event.target);
        if (repNode)
        {
            var row = Dom.getAncestorByClass(event.target, "memberRow");
            if (row)
            {
                this.selectRow(row, repNode);
                Events.cancelEvent(event);
            }
        }
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Breakpoints, DOMModule Listener

    onDomBreakpointAdded: function(context, object, name)
    {
        Trace.sysout("domBasePanel.onDomBreakpointAdded; propName: " + name +
            " (panel: " + this.name + ")", object);

        this.updateBreakpoints(object);
    },

    onDomBreakpointRemoved: function(context, object, name)
    {
        Trace.sysout("domBasePanel.onDomBreakpointRemoved; propName: " + name +
            " (panel: " + this.name + ")", object);

        this.updateBreakpoints(object);
    },

    updateBreakpoints: function(object)
    {
        // xxxHonza: the update should be smarter if possible. Can we just lookup
        // for the specific object and update the row directly?
        // Can we utilize DomTree widget?

        var breakpoints = this.context.dom.breakpoints;
        var rows = Dom.getElementsByClass(this.panelNode, "memberRow");
        for (var i = 0; i < rows.length; i++)
        {
            var row = rows[i];
            var member = row.domObject;

            var bp = breakpoints.findBreakpoint(member.object, member.name);
            if (bp)
            {
                row.setAttribute("breakpoint", "true");

                if (!bp.checked)
                    row.setAttribute("disabledBreakpoint", "true");
            }
            else
            {
                row.removeAttribute("breakpoint");
                row.removeAttribute("disabledBreakpoint");
            }
        }

        return null;
    },
});

// ********************************************************************************************* //
// Registration

Firebug.registerPanel(DOMPanel);

// xxxHonza: backward compatibility
Firebug.DOMPanel = DOMPanel;

return DOMPanel;

// ********************************************************************************************* //
});
