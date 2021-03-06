/* GlkOte -- a Javascript display library for IF interfaces
 * GlkOte Library: version 2.0.0.
 * Designed by Andrew Plotkin <erkyrath@eblong.com>
 * <http://eblong.com/zarf/glk/glkote.html>
 * 
 * This Javascript library is copyright 2008-13 by Andrew Plotkin. You may
 * copy and distribute it freely, by any means and under any conditions,
 * as long as the code and documentation is not changed. You may also
 * incorporate this code into your own program and distribute that, or
 * modify this code and use and distribute the modified version, as long
 * as you retain a notice in your program or documentation which mentions
 * my name and the URL shown above.
 *
 * GlkOte is a tool for creating interactive fiction -- and other text-based
 * applications -- on a web page. It is a Javascript library which handles
 * the mechanics of displaying text, arranging panes of text, and accepting
 * text input from the user.
 *
 * GlkOte is based on the Glk API. However, GlkOte's API is not identical to
 * Glk, even allowing for the differences between Javascript and C. GlkOte is
 * adapted to the realities of a web application environment -- a thin
 * Javascript layer which communicates with a distant server in intermittent
 * bursts.
 *
 * GlkOte can be used from two angles. First, in a purely client-side IF
 * application. The (included, optional) glkapi.js file facilitates this; it
 * wraps around GlkOte and provides an API that is identical to Glk, as
 * closely as Javascript allows. An IF interpreter written in Javascript,
 * running entirely within the user's web browser, can use glkapi.js just as
 * a C interpreter uses a normal Glk library. Or it could bypass glkapi.js
 * and use GlkOte directly.
 *
 * Alternatively, GlkOte could be used with a Glk library which acts as a
 * web service. However, this has not yet been implemented.
 *
 * For full documentation, see the docs.html file in this package.
 */


/* Put everything inside the GlkOte namespace. */
GlkOte = function() {

/* Module global variables */
var game_interface = null;
var windowport_id = 'windowport';
var gameport_id = 'gameport';
var windowport_el = null;
var gameport_el = null;
var generation = 0;
var disabled = false;
var loading_visible = null;
var windowdic = null;
var current_metrics = null;
var currently_focussed = false;
var last_known_focus = 0;
var last_known_paging = 0;
var windows_paging_count = 0;
var resize_timer = null;
var retry_timer = null;
var perform_paging = true;
var detect_external_links = false;
var regex_external_links = null;

/* Some handy constants */
/* A non-breaking space character. */
var NBSP = "\xa0";
/* Number of paragraphs to retain in a buffer window's scrollback. */
var max_buffer_length = 200;

/* Some constants for key event native values. (Not including function 
   keys.) */
var key_codes = {
  KEY_BACKSPACE: 8,
  KEY_TAB:       9,
  KEY_RETURN:   13,
  KEY_ESC:      27,
  KEY_LEFT:     37,
  KEY_UP:       38,
  KEY_RIGHT:    39,
  KEY_DOWN:     40,
  KEY_DELETE:   46,
  KEY_HOME:     36,
  KEY_END:      35,
  KEY_PAGEUP:   33,
  KEY_PAGEDOWN: 34,
  KEY_INSERT:   45
};

/* All the keys that can be used as line input terminators, and their
   native values. */
var terminator_key_names = {
    escape : key_codes.KEY_ESC,
    func1 : 112, func2 : 113, func3 : 114, func4 : 115, func5 : 116, 
    func6 : 117, func7 : 118, func8 : 119, func9 : 120, func10 : 121, 
    func11 : 122, func12 : 123
};
/* The inverse of the above. Maps native values to Glk key names. Set up at
   init time. */
var terminator_key_values = {};

/* This function becomes GlkOte.init(). The document calls this to begin
   the game. The simplest way to do this is to give the <body> tag an
   onLoad="GlkOte.init();" attribute.
*/
function glkote_init(iface) {
  if (!iface && window.Game)
    iface = window.Game;
  if (!iface) {
    glkote_error('No game interface object has been provided.');
    return;
  }
  if (!iface.accept) {
    glkote_error('The game interface object must have an accept() function.');
    return;
  }
  game_interface = iface;

  if (!window.jQuery || !$.fn.jquery) {
    glkote_error('The jQuery library has not been loaded.');
    return;
  }

  var version = $.fn.jquery.split('.');
  if (version.length < 2 || version[0] < 1 || (version[0] == 1 && version[1] < 9)) {
    glkote_error('This version of the jQuery library is too old. (Version ' + $.fn.jquery + ' found; 1.9.0 required.)');
    return;
  }

  /* Set up a static table. */
  for (var val in terminator_key_names) {
    terminator_key_values[terminator_key_names[val]] = val;
  }

  if (false) {
    /* ### test for mobile browser? "'ontouchstart' in document.documentElement"? */
    /* Paging doesn't make sense for iphone/android, because you can't
       get keystroke events from a window. */
    perform_paging = false;
  }

  /* Object mapping window ID (strings) to window description objects. */
  windowdic = {};

  if (iface.windowport)
      windowport_id = iface.windowport;
  if (iface.gameport)
      gameport_id = iface.gameport;

  gameport_el = $('#'+gameport_id);
  if (!gameport_el.length) {
      glkote_error('Cannot find gameport element #'+gameport_id+' in this document.');
      return;
  }

  windowport_el = $('#'+windowport_id, gameport_el);
  if (!windowport_el.length) {
    glkote_error('Cannot find windowport element #'+windowport_id+' in the gameport.');
    return;
  }
  windowport_el.empty();
  if (perform_paging)
    $(document).on('keypress', evhan_doc_keypress);
  $(window).on('resize', evhan_doc_resize);

  var res = measure_window();
  if (jQuery.type(res) === 'string') {
    glkote_error(res);
    return;
  }
  current_metrics = res;

  detect_external_links = iface.detect_external_links;
  if (detect_external_links) {
    regex_external_links = iface.regex_external_links;
    if (!regex_external_links) {
      /* Fill in a default regex for matching or finding URLs. */
      if (detect_external_links == 'search') {
        /* The searching case is hard. This regex is based on John Gruber's
           monstrosity, the "web URL only" variant:
           http://daringfireball.net/2010/07/improved_regex_for_matching_urls
           I cut it down a bit; it will not recognize bare domain names like
           "www.eblong.com". I also removed the "(?i)" from the beginning,
           because Javascript doesn't handle that syntax. (It's supposed to
           make the regex case-insensitive.) Instead, we use the 'i'
           second argument to RegExp().
        */
        regex_external_links = RegExp('\\b((?:https?://)(?:[^\\s()<>]+|\\(([^\\s()<>]+|(\\([^\\s()<>]+\\)))*\\))+(?:\\(([^\\s()<>]+|(\\([^\\s()<>]+\\)))*\\)|[^\\s`!()\\[\\]{};:\'".,<>?\u00ab\u00bb\u201c\u201d\u2018\u2019]))', 'i');
      }
      else {
        /* The matching case is much simpler. This matches any string
           beginning with "http" or "https". */
        regex_external_links = RegExp('^https?:', 'i');
      }
    }
  }

  send_response('init', null, current_metrics);
}

/* Work out various pixel measurements used to compute window sizes:
   - the width and height of the windowport
   - the width and height of a character in a grid window
   - ditto for buffer windows (although this is only approximate, since
     buffer window fonts can be non-fixed-width, and styles can have
     different point sizes)
   - the amount of padding space around buffer and grid window content

   This stuff is determined by measuring the dimensions of the (invisible,
   offscreen) windows in the layouttestpane div.
*/
function measure_window() {
  var metrics = {};
  var el, linesize, winsize, line1size, line2size, spansize;

  /* We assume the gameport is the same size as the windowport, which
     is true on all browsers but IE7. Fortunately, on IE7 it's
     the windowport size that's wrong -- gameport is the size
     we're interested in. */

  /* Exclude padding and border. */
  metrics.width = gameport_el.width();
  metrics.height = gameport_el.height();

  el = $('#layouttest_grid', gameport_el);
  if (!el.length)
    return 'Cannot find layouttest_grid element for window measurement.';

  /* Here we will include padding and border. */
  winsize = { width:el.outerWidth(), height:el.outerHeight() };
  el = $('#layouttest_gridspan', gameport_el);
  spansize = { width:el.outerWidth(), height:el.outerHeight() };
  el = $('#layouttest_gridline', gameport_el);
  line1size = { width:el.outerWidth(), height:el.outerHeight() };
  el = $('#layouttest_gridline2', gameport_el);
  line2size = { width:el.outerWidth(), height:el.outerHeight() };

  metrics.gridcharheight = ($('#layouttest_gridline2', gameport_el).position().top
    - $('#layouttest_gridline', gameport_el).position().top);
  metrics.gridcharwidth = ($('#layouttest_gridspan', gameport_el).width() / 8);
  /* Yes, we can wind up with a non-integer charwidth value. */

  /* Find the total margin around the character grid (out to the window's
     padding/border). These values include both sides (left+right,
     top+bottom). */
  metrics.gridmarginx = winsize.width - spansize.width;
  metrics.gridmarginy = winsize.height - (line1size.height + line2size.height);

  el = $('#layouttest_buffer', gameport_el);
  if (!el.length)
    return 'Cannot find layouttest_buffer element for window measurement.';

  /* Here we will include padding and border. */
  winsize = { width:el.outerWidth(), height:el.outerHeight() };
  el = $('#layouttest_bufferspan', gameport_el);
  spansize = { width:el.outerWidth(), height:el.outerHeight() };
  el = $('#layouttest_bufferline', gameport_el);
  line1size = { width:el.outerWidth(), height:el.outerHeight() };
  el = $('#layouttest_bufferline2', gameport_el);
  line2size = { width:el.outerWidth(), height:el.outerHeight() };

  metrics.buffercharheight = ($('#layouttest_bufferline2', gameport_el).position().top
    - $('#layouttest_bufferline', gameport_el).position().top);
  metrics.buffercharwidth = ($('#layouttest_bufferspan', gameport_el).width() / 8);
  /* Yes, we can wind up with a non-integer charwidth value. */

  /* Again, these values include both sides (left+right, top+bottom). */
  metrics.buffermarginx = winsize.width - spansize.width;
  metrics.buffermarginy = winsize.height - (line1size.height + line2size.height);

  /* these values come from the game interface object */
  metrics.outspacingx = 0;
  metrics.outspacingy = 0;
  metrics.inspacingx = 0;
  metrics.inspacingy = 0;

  if (game_interface.spacing != undefined) {
    metrics.outspacingx = game_interface.spacing;
    metrics.outspacingy = game_interface.spacing;
    metrics.inspacingx = game_interface.spacing;
    metrics.inspacingy = game_interface.spacing;
  }
  if (game_interface.outspacing != undefined) {
    metrics.outspacingx = game_interface.outspacing;
    metrics.outspacingy = game_interface.outspacing;
  }
  if (game_interface.inspacing != undefined) {
    metrics.inspacingx = game_interface.inspacing;
    metrics.inspacingy = game_interface.inspacing;
  }
  if (game_interface.inspacingx != undefined)
    metrics.inspacingx = game_interface.inspacingx;
  if (game_interface.inspacingy != undefined)
    metrics.inspacingy = game_interface.inspacingy;
  if (game_interface.outspacingx != undefined)
    metrics.outspacingx = game_interface.outspacingx;
  if (game_interface.outspacingy != undefined)
    metrics.outspacingy = game_interface.outspacingy;

  return metrics;
}

/* This function becomes GlkOte.update(). The game calls this to update
   the screen state. The argument includes all the information about new
   windows, new text, and new input requests -- everything necessary to
   construct a new display state for the user.
*/
function glkote_update(arg) {
  hide_loading();

  if (arg.type == 'error') {
    glkote_error(arg.message);
    return;
  }

  if (arg.type == 'pass') {
    return;
  }

  if (arg.type == 'retry') {
    if (!retry_timer) {
      glkote_log('Event has timed out; will retry...');
      show_loading();
      retry_timer = delay_func(2, retry_update);
    }
    else {
      glkote_log('Event has timed out, but a retry is already queued!');
    }
    return;
  }

  if (arg.type != 'update') {
    glkote_log('Ignoring unknown message type ' + arg.type + '.');
    return;
  }

  if (arg.gen == generation) {
    /* Nothing has changed. */
    glkote_log('Ignoring repeated generation number: ' + generation);
    return;
  }
  if (arg.gen < generation) {
    /* This update belongs in the past. */
    glkote_log('Ignoring out-of-order generation number: got ' + arg.gen + ', currently at ' + generation);
    return;
  }
  generation = arg.gen;

  /* Un-disable the UI, if it was previously disabled. */
  if (disabled) {
    $.each(windowdic, function(winid, win) {
      if (win.inputel) {
        win.inputel.prop('disabled', false);
      }
    });
    disabled = false;
  }

  /* Perform the updates, in a most particular order. */

  if (arg.input != null)
    accept_inputcancel(arg.input);
  if (arg.windows != null)
    accept_windowset(arg.windows);
  if (arg.content != null)
    accept_contentset(arg.content);
  if (arg.input != null)
    accept_inputset(arg.input);

  if (arg.specialinput != null)
    accept_specialinput(arg.specialinput);

  /* Any buffer windows that have changed need to be scrolled down.
     Then, we take the opportunity to update topunseen. (If a buffer
     window hasn't changed, topunseen hasn't changed.) */

  $.each(windowdic, function(winid, win) {
    if (win.type == 'buffer' && win.needscroll) {
      /* needscroll is true if the window has accumulated any content or
         an input field in this update cycle. needspaging is true if
         the window has any unviewed content from *last* cycle; we set 
         it now if any new content remains unviewed after the first
         obligatory scrolldown. 
         (If perform_paging is false, we forget about needspaging and
         just always scroll to the bottom.) */
      win.needscroll = false;

      if (!win.needspaging) {
        var frameel = win.frameel;

        if (!perform_paging) {
          /* Scroll all the way down. Note that scrollHeight is not a jQuery
             property; we have to go to the raw DOM to get it. */
          frameel.scrollTop(frameel.get(0).scrollHeight);
          win.needspaging = false;
        }
        else {
          /* Scroll the unseen content to the top. */
          frameel.scrollTop(win.topunseen - current_metrics.buffercharheight);
          /* Compute the new topunseen value. */
          var frameheight = frameel.outerHeight();
          var realbottom = last_line_top_offset(frameel);
          var newtopunseen = frameel.scrollTop() + frameheight;
          if (newtopunseen > realbottom)
            newtopunseen = realbottom;
          if (win.topunseen < newtopunseen)
            win.topunseen = newtopunseen;
          /* The scroll-down has not touched needspaging, because it is
             currently false. Let's see if it should be true. */
          if (frameel.scrollTop() + frameheight >= frameel.get(0).scrollHeight) {
            win.needspaging = false;
          }
          else {
            win.needspaging = true;
          }
        }

        /* Add or remove the more prompt, based on the new needspaging flag. */
        var moreel = $('#win'+win.id+'_moreprompt', gameport_el);
        if (!win.needspaging) {
          if (moreel.length)
            moreel.remove();
        }
        else {
          if (!moreel.length) {
            moreel = $('<div>',
              { id: 'win'+win.id+'_moreprompt', 'class': 'MorePrompt' } );
            moreel.append('More');
            /* 20 pixels is a cheap approximation of a scrollbar-width. */
            var morex = win.coords.right + 20;
            var morey = win.coords.bottom;
            moreel.css({ bottom:morey+'px', right:morex+'px' });
            windowport_el.append(moreel);
          }
        }
      }
    }
  });

  /* Set windows_paging_count. (But don't set the focus -- we'll do that
     momentarily.) */
  readjust_paging_focus(false);

  /* Disable everything, if that was requested (or if this is a special
     input cycle). */
  disabled = false;
  if (arg.disable || arg.specialinput) {
    disabled = true;
    $.each(windowdic, function(winid, win) {
      if (win.inputel) {
        win.inputel.prop('disabled', true);
      }
    });
  }

  /* Figure out which window to set the focus to. (But not if the UI is
     disabled. We also skip this if there's paging to be done, because
     focussing might autoscroll and we want to trap keystrokes for 
     paging anyhow.) */

  var newinputwin = 0;
  if (!disabled && !windows_paging_count) {
    $.each(windowdic, function(winid, win) {
      if (win.input) {
        if (!newinputwin || win.id == last_known_focus)
          newinputwin = win.id;
      }
    });
  }

  if (newinputwin) {
    /* MSIE is weird about when you can call focus(). The input element
       has probably just been added to the DOM, and MSIE balks at
       giving it the focus right away. So we defer the call until
       after the javascript context has yielded control to the browser. */
    var focusfunc = function() {
      var win = windowdic[newinputwin];
      if (win.inputel) {
        win.inputel.focus();
      }
    };
    defer_func(focusfunc);
  }

  /* Done with the update. Exit and wait for the next input event. */
}

/* Handle all the window changes. The argument lists all windows that
   should be open. Any unlisted windows, therefore, get closed.

   Note that if there are no changes to the window state, this function
   will not be called. This is different from calling this function with
   an empty argument object (which would mean "close all windows").
*/
function accept_windowset(arg) {
  $.each(windowdic, function(winid, win) { win.inplace = false; });
  $.map(arg, accept_one_window);

  /* Close any windows not mentioned in the argument. */
  var closewins = $.map(windowdic, function(win, winid) {
      if (!win.inplace)
        return win;
    });
  $.map(closewins, close_one_window);
}

/* Handle the update for a single window. Open it if it doesn't already
   exist; set its size and position, if those need to be changed.
*/
function accept_one_window(arg) {
  var frameel, win;

  if (!arg) {
    return;
  }

  win = windowdic[arg.id];
  if (win == null) {
    /* The window must be created. */
    win = { id: arg.id, type: arg.type, rock: arg.rock };
    windowdic[arg.id] = win;
    var typeclass;
    if (win.type == 'grid')
      typeclass = 'GridWindow';
    if (win.type == 'buffer')
      typeclass = 'BufferWindow';
    var rockclass = 'WindowRock_' + arg.rock;
    frameel = $('<div>',
      { id: 'window'+arg.id,
        'class': 'WindowFrame ' + typeclass + ' ' + rockclass });
    frameel.data('winid', arg.id);
    frameel.on('mousedown', arg.id, evhan_window_mousedown);
    if (perform_paging && win.type == 'buffer')
      frameel.on('scroll', arg.id, evhan_window_scroll);
    win.frameel = frameel;
    win.gridheight = 0;
    win.gridwidth = 0;
    win.input = null;
    win.inputel = null;
    win.terminators = {};
    win.reqhyperlink = false;
    win.needscroll = false;
    win.needspaging = false;
    win.topunseen = 0;
    win.coords = { left:null, top:null, right:null, bottom:null };
    win.history = new Array();
    win.historypos = 0;
    windowport_el.append(frameel);
  }
  else {
    frameel = win.frameel;
    if (win.type != arg.type)
      glkote_error('Window ' + arg.id + ' was created with type ' + win.type + ', but now is described as type ' + arg.type);
  }

  win.inplace = true;

  if (win.type == 'grid') {
    /* Make sure we have the correct number of GridLine divs. */
    var ix;
    if (arg.gridheight > win.gridheight) {
      for (ix=win.gridheight; ix<arg.gridheight; ix++) {
        var el = $('<div>',
          { id: 'win'+win.id+'_ln'+ix, 'class': 'GridLine' });
        el.append(NBSP);
        win.frameel.append(el);
      }
    }
    if (arg.gridheight < win.gridheight) {
      for (ix=arg.gridheight; ix<win.gridheight; ix++) {
        var el = $('#win'+win.id+'_ln'+ix, gameport_el);
        if (el.length)
          el.remove();
      }
    }
    win.gridheight = arg.gridheight;
    win.gridwidth = arg.gridwidth;
  }

  if (win.type == 'buffer') {
    /* Don't need anything? */
  }

  /* The trick is that left/right/top/bottom are measured to the outside
     of the border, but width/height are measured from the inside of the
     border. (Measured by the browser's DOM methods, I mean.) */
  var styledic;
  if (0 /*###Prototype.Browser.IE*/) {
    /* Actually this method works in Safari also, but in Firefox the buffer
       windows are too narrow by a scrollbar-width. So we don't use it
       generally. */
    var width = arg.width;
    var height = arg.height;
    if (arg.type == 'grid') {
      width -= current_metrics.gridmarginx;
      height -= current_metrics.gridmarginy;
    }
    if (arg.type == 'buffer') {
      width -= current_metrics.buffermarginx;
      height -= current_metrics.buffermarginy;
    }
    if (width < 0)
      width = 0;
    if (height < 0)
      height = 0;
    styledic = { left: arg.left+'px', top: arg.top+'px',
      width: width+'px', height: height+'px' };
    win.coords.left = arg.left;
    win.coords.top = arg.top;
    win.coords.right = current_metrics.width - (arg.left+arg.width);
    win.coords.bottom = current_metrics.height - (arg.top+arg.height);
  }
  else {
    /* This method works in everything but IE. */
    var right = current_metrics.width - (arg.left + arg.width);
    var bottom = current_metrics.height - (arg.top + arg.height);
    styledic = { left: arg.left+'px', top: arg.top+'px',
      right: right+'px', bottom: bottom+'px' };
    win.coords.left = arg.left;
    win.coords.top = arg.top;
    win.coords.right = right;
    win.coords.bottom = bottom;
  }
  frameel.css(styledic);
}

/* Handle closing one window. */
function close_one_window(win) {
  win.frameel.remove();
  delete windowdic[win.id];
  win.frameel = null;

  var moreel = $('#win'+win.id+'_moreprompt', gameport_el);
  if (moreel.length)
    moreel.remove();
}

/* Regular expressions used in twiddling runs of whitespace. */
var regex_initial_whitespace = new RegExp('^ ');
var regex_final_whitespace = new RegExp(' $');
var regex_long_whitespace = new RegExp('  +', 'g'); /* two or more spaces */

/* Given a run of N spaces (N >= 2), return N-1 non-breaking spaces plus
   a normal one. */
function func_long_whitespace(match) {
  var len = match.length;
  if (len == 1)
    return ' ';
  /* Evil trick I picked up from Prototype. Gives len-1 copies of NBSP. */
  var res = new Array(len).join(NBSP);
  return res + ' ';
}

/* Handle all of the window content changes. */
function accept_contentset(arg) {
  $.map(arg, accept_one_content);
}

/* Handle the content changes for a single window. */
function accept_one_content(arg) {
  var win = windowdic[arg.id];

  /* Check some error conditions. */

  if (win == null) {
    glkote_error('Got content update for window ' + arg.id + ', which does not exist.');
    return;
  }

  if (win.input && win.input.type == 'line') {
    glkote_error('Got content update for window ' + arg.id + ', which is awaiting line input.');
    return;
  }

  win.needscroll = true;

  if (win.type == 'grid') {
    /* Modify the given lines of the grid window (and leave the rest alone). */
    var lines = arg.lines;
    var ix, sx;
    for (ix=0; ix<lines.length; ix++) {
      var linearg = lines[ix];
      var linenum = linearg.line;
      var content = linearg.content;
      var lineel = $('#win'+win.id+'_ln'+linenum, gameport_el);
      if (!lineel.length) {
        glkote_error('Got content for nonexistent line ' + linenum + ' of window ' + arg.id + '.');
        continue;
      }
      if (!content || !content.length) {
        lineel.text(NBSP);
      }
      else {
        lineel.empty();
        for (sx=0; sx<content.length; sx++) {
          var rdesc = content[sx];
          var rstyle, rtext, rlink;
          if (rdesc.length === undefined) {
            rstyle = rdesc.style;
            rtext = rdesc.text;
            rlink = rdesc.hyperlink;
          }
          else {
            rstyle = rdesc;
            sx++;
            rtext = content[sx];
            rlink = undefined;
          }
          var el = $('<span>',
            { 'class': 'Style_' + rstyle } );
          if (rlink == undefined) {
            insert_text_detecting(el, rtext);
          }
          else {
            var ael = $('<a>',
              { 'href': '#', 'class': 'Internal' } );
            ael.text(rtext);
            ael.on('click', build_evhan_hyperlink(win.id, rlink));
            el.append(ael);
          }
          lineel.append(el);
        }
      }
    }
  }

  if (win.type == 'buffer') {
    /* Append the given lines onto the end of the buffer window. */
    var text = arg.text;
    var ix, sx;

    if (win.inputel) {
      /* This can happen if we're waiting for char input. (Line input
         would make this content update illegal -- but we already checked
         that.) The inputel is inside the cursel, which we're about to
         rip out. We remove it, so that we can put it back later. */
        win.inputel.detach();
    }

    var cursel = $('#win'+win.id+'_cursor', gameport_el);
    if (cursel.length)
      cursel.remove();
    cursel = null;

    if (arg.clear) {
      win.frameel.empty();
      win.topunseen = 0;
    }

    /* Each line we receive has a flag indicating whether it *starts*
       a new paragraph. (If the flag is false, the line gets appended
       to the previous paragraph.)

       We have to keep track of two flags per paragraph div. The blankpara
       flag indicates whether this is a completely empty paragraph (a
       blank line). We have to drop a NBSP into empty paragraphs --
       otherwise they'd collapse -- and so this flag lets us distinguish
       between an empty paragraph and one which truly contains a NBSP.
       (The difference is, when you append data to a truly empty paragraph,
       you have to delete the placeholder NBSP.)

       The endswhite flag indicates whether the paragraph ends with a
       space (or is completely empty). See below for why that's important. */

    for (ix=0; ix<text.length; ix++) {
      var textarg = text[ix];
      var content = textarg.content;
      var divel = null;
      if (textarg.append) {
        if (!content || !content.length)
          continue;
        divel = last_child_of(win.frameel);
      }
      if (divel == null) {
        /* Create a new paragraph div */
        divel = $('<div>', { 'class': 'BufferLine' });
        divel.data('blankpara', true);
        divel.data('endswhite', true);
        win.frameel.append(divel);
      }
      else {
        /* jquery-wrap the element. */
        divel = $(divel);
      }
      if (!content || !content.length) {
        if (divel.data('blankpara'))
          divel.text(NBSP);
        continue;
      }
      if (divel.data('blankpara')) {
        divel.data('blankpara', false);
        divel.empty();
      }
      /* We must munge long strings of whitespace to make sure they aren't
         collapsed. (This wouldn't be necessary if "white-space: pre-wrap"
         were widely implemented. Oh well.) ### Use if available?
         The rule: if we find a block of spaces, turn all but the last one
         into NBSP. Also, if a div's last span ends with a space (or the
         div has no spans), and a new span begins with a space, turn that
         into a NBSP. */
      for (sx=0; sx<content.length; sx++) {
        var rdesc = content[sx];
        var rstyle, rtext, rlink;
        if (rdesc.length === undefined) {
          rstyle = rdesc.style;
          rtext = rdesc.text;
          rlink = rdesc.hyperlink;
        }
        else {
          rstyle = rdesc;
          sx++;
          rtext = content[sx];
          rlink = undefined;
        }
        var el = $('<span>',
          { 'class': 'Style_' + rstyle } );
        rtext = rtext.replace(regex_long_whitespace, func_long_whitespace);
        if (divel.data('endswhite')) {
          rtext = rtext.replace(regex_initial_whitespace, NBSP);
        }
        if (rlink == undefined) {
          insert_text_detecting(el, rtext);
        }
        else {
          var ael = $('<a>',
            { 'href': '#', 'class': 'Internal' } );
          ael.text(rtext);
          ael.on('click', build_evhan_hyperlink(win.id, rlink));
          el.append(ael);
        }
        divel.append(el);
        divel.data('endswhite', regex_final_whitespace.test(rtext));
      }
    }

    /* Trim the scrollback. If there are more than max_buffer_length
       paragraphs, delete some. (It would be better to limit by
       character count, rather than paragraph count. But this is
       easier.) */
    var parals = win.frameel.children();
    if (parals.length) {
      var totrim = parals.length - max_buffer_length;
      if (totrim > 0) {
        var ix, obj;
        win.topunseen -= parals.get(totrim).offsetTop;
        if (win.topunseen < 0)
          win.topunseen = 0;
        for (ix=0; ix<totrim; ix++) {
          $(parals.get(ix)).remove();
        }
      }
    }

    /* Stick the invisible cursor-marker at the end. We use this to
       position the input box. */
    var divel = last_child_of(win.frameel);
    if (divel) {
      cursel = $('<span>',
        { id: 'win'+win.id+'_cursor', 'class': 'InvisibleCursor' } );
      cursel.append(NBSP);
      $(divel).append(cursel);

      if (win.inputel) {
        /* Put back the inputel that we found earlier. */
        var inputel = win.inputel;
        var pos = cursel.position();
        /* This calculation is antsy. (Was on Prototype, anyhow, I haven't
           retested in jquery...) On Firefox, buffermarginx is too high (or
           getWidth() is too low) by the width of a scrollbar. On MSIE,
           buffermarginx is one pixel too low. We fudge for that, giving a
           result which errs on the low side. */
        var width = win.frameel.width() - (current_metrics.buffermarginx + pos.left + 2);
        if (width < 1)
          width = 1;
        /* ### opera absolute positioning failure? */
        inputel.css({ position: 'absolute',
          left: '0px', top: '0px', width: width+'px' });
        cursel.append(inputel);
      }
    }
  }
}

/* Handle all necessary removal of input fields.

   A field needs to be removed if it is not listed in the input argument,
   *or* if it is listed with a later generation number than we remember.
   (The latter case means that input was cancelled and restarted.)
*/
function accept_inputcancel(arg) {
  var hasinput = {};
  $.map(arg, function(argi) { 
    if (argi.type)
      hasinput[argi.id] = argi;
  });

  $.each(windowdic, function(winid, win) {
    if (win.input) {
      var argi = hasinput[win.id];
      if (argi == null || argi.gen > win.input.gen) {
        /* cancel this input. */
        win.input = null;
        if (win.inputel) {
          win.inputel.remove();
          win.inputel = null;
        }
      }
    }
  });
}

/* Handle all necessary creation of input fields. Also, if a field needs
   to change position, move it.
*/
function accept_inputset(arg) {
  var hasinput = {};
  var hashyperlink = {};
  $.map(arg, function(argi) {
    if (argi.type)
      hasinput[argi.id] = argi;
    if (argi.hyperlink)
      hashyperlink[argi.id] = true;
  });

  $.each(windowdic, function(tmpid, win) {
    win.reqhyperlink = hashyperlink[win.id];

    var argi = hasinput[win.id];
    if (argi == null)
      return;
    win.input = argi;

    /* Maximum number of characters to accept. */
    var maxlen = 1;
    if (argi.type == 'line')
      maxlen = argi.maxlen;

    var inputel = win.inputel;
    if (inputel == null) {
      var classes = 'Input';
      if (argi.type == 'line') {
        classes += ' LineInput';
      }
      else if (argi.type == 'char') {
        classes += ' CharInput';
      }
      else {
        glkote_error('Window ' + win.id + ' has requested unrecognized input type ' + argi.type + '.');
      }
      inputel = $('<input>',
        { id: 'win'+win.id+'_input',
          'class': classes, type: 'text', maxlength: maxlen });
      if (true) /* should be mobile-webkit-only? */
        inputel.attr('autocapitalize', 'off');
      if (argi.type == 'line') {
        inputel.on('keypress', evhan_input_keypress);
        inputel.on('keydown', evhan_input_keydown);
        if (argi.initial)
          inputel.val(argi.initial);
        win.terminators = {};
        if (argi.terminators) {
          for (var ix=0; ix<argi.terminators.length; ix++) 
            win.terminators[argi.terminators[ix]] = true;
        }
      }
      else if (argi.type == 'char') {
        inputel.on('keypress', evhan_input_char_keypress);
        inputel.on('keydown', evhan_input_char_keydown);
      }
      inputel.on('focus', win.id, evhan_input_focus);
      inputel.on('blur', win.id, evhan_input_blur);
      inputel.data('winid', win.id);
      win.inputel = inputel;
      win.historypos = win.history.length;
      win.needscroll = true;
    }

    if (win.type == 'grid') {
      var lineel = $('#win'+win.id+'_ln'+argi.ypos, gameport_el);
      if (!lineel.length) {
        glkote_error('Window ' + win.id + ' has requested input at unknown line ' + argi.ypos + '.');
        return;
      }
      var pos = lineel.position();
      var xpos = pos.left + Math.round(argi.xpos * current_metrics.gridcharwidth);
      var width = Math.round(maxlen * current_metrics.gridcharwidth);
      /* This calculation is antsy. See below. (But grid window line input
         is rare in IF.) */
      var maxwidth = win.frameel.width() - (current_metrics.buffermarginx + xpos + 2);
      if (width > maxwidth)
        width = maxwidth;
      inputel.css({ position: 'absolute',
        left: xpos+'px', top: pos.top+'px', width: width+'px' });
      win.frameel.append(inputel);
    }

    if (win.type == 'buffer') {
      var cursel = $('#win'+win.id+'_cursor', gameport_el);
      if (!cursel.length) {
        cursel = $('<span>',
          { id: 'win'+win.id+'_cursor', 'class': 'InvisibleCursor' } );
        cursel.append(NBSP);
        win.frameel.append(cursel);
      }
      var pos = cursel.position();
      /* This calculation is antsy. (Was on Prototype, anyhow, I haven't
           retested in jquery...) On Firefox, buffermarginx is too high (or
           getWidth() is too low) by the width of a scrollbar. On MSIE,
           buffermarginx is one pixel too low. We fudge for that, giving a
           result which errs on the low side. */
      var width = win.frameel.width() - (current_metrics.buffermarginx + pos.left + 2);
      if (width < 1)
        width = 1;
      /* ### opera absolute positioning failure? */
      inputel.css({ position: 'absolute',
        left: '0px', top: '0px', width: width+'px' });
      cursel.append(inputel);
    }
  });
}

function accept_specialinput(arg) {
  if (arg.type == 'fileref_prompt') {
    var replyfunc = function(ref) {
      send_response('specialresponse', null, 'fileref_prompt', ref);
    };
    try {
      var writable = (arg.filemode != 'read');
      Dialog.open(writable, arg.filetype, arg.gameid, replyfunc);
    }
    catch (ex) {
      GlkOte.log('Unable to open file dialog: ' + ex);
      /* Return a failure. But we don't want to call send_response before
         glkote_update has finished, so we defer the reply slightly. */
      replyfunc = function(ref) {
        send_response('specialresponse', null, 'fileref_prompt', null);
      };
      defer_func(replyfunc);
    }
  }
  else {
    glkote_error('Request for unknown special input type: ' + arg.type);
  }
}

/* Return the vertical offset (relative to the parent) of the top of the 
   last child of the parent. We use the raw DOM "offsetTop" property;
   jQuery doesn't have an accessor for it.
   (Possibly broken in MSIE7? It worked in the old version, though.)
*/
function last_line_top_offset(el) {
  var ls = el.children();
  if (!ls || !ls.length)
    return 0;
  return ls.get(ls.length-1).offsetTop;
}

/* Set windows_paging_count to the number of windows that need paging.
   If that's nonzero, pick an appropriate window for the paging focus.

   The canfocus flag determines whether this function can jump to an
   input field focus (should paging be complete).

   This must be called whenever a window's needspaging flag changes.
*/
function readjust_paging_focus(canfocus) {
  windows_paging_count = 0;
  var pageable_win = 0;

  if (perform_paging) {
    $.each(windowdic, function(tmpid, win) {
        if (win.needspaging) {
          windows_paging_count += 1;
          if (!pageable_win || win.id == last_known_paging)
            pageable_win = win.id;
        }
      });
  }
    
  if (windows_paging_count) {
    /* pageable_win will be set. This is our new paging focus. */
    last_known_paging = pageable_win;
  }

  if (!windows_paging_count && canfocus) {
    /* Time to set the input field focus. This is the same code as in
       the update routine, although somewhat simplified since we don't
       need to worry about the DOM being in flux. */

    var newinputwin = 0;
    if (!disabled && !windows_paging_count) {
      $.each(windowdic, function(tmpid, win) {
          if (win.input) {
            if (!newinputwin || win.id == last_known_focus)
              newinputwin = win.id;
          }
        });
    }
    
    if (newinputwin) {
      var win = windowdic[newinputwin];
      if (win.inputel) {
        win.inputel.focus();
      }
    }
  }
}

/* Return the game interface object that was provided to init(). Call
   this if a subsidiary library (e.g., dialog.js) needs to imitate some
   display setting. Do not try to modify the object; it will probably
   not do what you want.
*/
function glkote_get_interface() {
  return game_interface;
}

/* Log the message in the browser's error log, if it has one. (This shows
   up in Safari, in Opera, and in Firefox if you have Firebug installed.)
*/
function glkote_log(msg) {
  if (window.console && console.log)
    console.log(msg);
  else if (window.opera && opera.postError)
    opera.postError(msg);
}

/* Display the red error pane, with a message in it. This is called on
   fatal errors.

   Deliberately does not use any jQuery functionality, because this
   is called when jQuery couldn't be loaded.
*/
function glkote_error(msg) {
  var el = document.getElementById('errorcontent');
  remove_children(el);
  el.appendChild(document.createTextNode(msg));

  el = document.getElementById('errorpane');
  el.style.display = '';   /* el.show() */

  hide_loading();
}

/* Cause an immediate input event, of type "external". This invokes
   Game.accept(), just like any other event.
*/
function glkote_extevent(val) {
  send_response('external', null, val);
}

/* If we got a 'retry' result from the game, we wait a bit and then call
   this function to try it again.
*/
function retry_update() {
  retry_timer = null;
  glkote_log('Retrying update...');

  send_response('refresh', null, null);
}

/* Hide the error pane. */
function clear_error() {
  $('#errorpane', gameport_el).hide();
}

/* Hide the loading pane (the spinny compass), if it hasn't already been
   hidden.

   Deliberately does not use any jQuery functionality.
*/
function hide_loading() {
  if (loading_visible == false)
    return;
  loading_visible = false;

  var el = document.getElementById('loadingpane');
  if (el) {
    el.style.display = 'none';  /* el.hide() */
  }
}

/* Show the loading pane (the spinny compass), if it isn't already visible.

   Deliberately does not use any jQuery functionality.
*/
function show_loading() {
  if (loading_visible == true)
    return;
  loading_visible = true;

  var el = document.getElementById('loadingpane');
  if (el) {
    el.style.display = '';   /* el.show() */
  }
}

/* Remove all children from a DOM element. (Not a jQuery collection!)

   Deliberately does not use any jQuery functionality.
*/
function remove_children(parent) {
  var obj, ls;
  ls = parent.childNodes;
  while (ls.length > 0) {
    obj = ls.item(0);
    parent.removeChild(obj);
  }
}

/* Return the last child element of a DOM element. (Ignoring text nodes.)
   If the element has no element children, this returns null.
   This returns a raw DOM element! Remember to $() it if you want to pass
   it to jquery.
*/
function last_child_of(obj) {
  var ls = obj.children();
  if (!ls || !ls.length)
    return null;
  return ls.get(ls.length-1);
}

/* Add text to a DOM element. If GlkOte is configured to detect URLs,
   this does that, converting them into 
   <a href='...' class='External' target='_blank'> tags.
   
   This requires calls to document.createTextNode, because jQuery doesn't
   have a notion of appending literal text. I swear...
*/
function insert_text_detecting(el, val) {
  if (!detect_external_links) {
    el.append(document.createTextNode(val));
    return;
  }

  if (detect_external_links == 'match') {
    /* For 'match', we test the entire span of text to see if it's a URL.
       This is simple and fast. */
    if (regex_external_links.test(val)) {
      var ael = $('<a>',
        { 'href': val, 'class': 'External', 'target': '_blank' } );
      ael.text(val);
      el.append(ael);
      return;
    }
    /* If not, fall through. */
  }
  else if (detect_external_links == 'search') {
    /* For 'search', we have to look for a URL within the span -- perhaps
       multiple URLs. This is more work, and the regex is more complicated
       too. */
    while (true) {
      var match = regex_external_links.exec(val);
      if (!match)
        break;
      /* Add the characters before the URL, if any. */
      if (match.index > 0) {
        var prefix = val.substring(0, match.index);
        el.append(document.createTextNode(prefix));
      }
      /* Add the URL. */
      var ael = $('<a>',
        { 'href': match[0], 'class': 'External', 'target': '_blank' } );
      ael.text(match[0]);
      el.append(ael);
      /* Continue searching after the URL. */
      val = val.substring(match.index + match[0].length);
    }
    if (!val.length)
      return;
    /* Add the final string of characters, if there were any. */
  }

  /* Fall-through case. Just add the text. */
  el.append(document.createTextNode(val));
}

/* Run a function (no arguments) in timeout seconds. */
function delay_func(timeout, func)
{
  return window.setTimeout(func, timeout*1000);
}

/* Run a function (no arguments) "soon". */
function defer_func(func)
{
  return window.setTimeout(func, 0.01*1000);
}

/* Debugging utility: return a string displaying all of an object's
   properties, recursively. (Do not call this on an object which references
   anything big!) */
function inspect_deep(res) {
  var keys = $.map(res, function(val, key) { return key; });
  keys.sort();
  var els = $.map(keys, function(key) {
      var val = res[key];
      if (jQuery.type(val) === 'string')
        val = "'" + val + "'";
      else if (!(jQuery.type(val) === 'number'))
        val = inspect_deep(val);
      return key + ':' + val;
    });
  return '{' + els.join(', ') + '}';
}

/* Debugging utility: same as above, but only one level deep. */
function inspect_shallow(res) {
  var keys = $.map(res, function(val, key) { return key; });
  keys.sort();
  var els = $.map(keys, function(key) {
      var val = res[key];
      if (jQuery.type(val) === 'string')
        val = "'" + val + "'";
      return key + ':' + val;
    });
  return '{' + els.join(', ') + '}';
}

/* Add a line to the window's command history, and then submit it to
   the game. (This is a utility function used by various keyboard input
   handlers.)
*/
function submit_line_input(win, val, termkey) {
  var historylast = null;
  if (win.history.length)
    historylast = win.history[win.history.length-1];

  /* Store this input in the command history for this window, unless
     the input is blank or a duplicate. */
  if (val && val != historylast) {
    win.history.push(val);
    if (win.history.length > 20) {
      /* Don't keep more than twenty entries. */
      win.history.shift();
    }
  }

  send_response('line', win, val, termkey);
}

/* Invoke the game interface's accept() method, passing along an input
   event, and also including all the information about incomplete line
   inputs.

   This is called by each event handler that can signal a completed input
   event.

   The val and val2 arguments are only used by certain event types, which
   is why most of the invocations pass three arguments instead of four.
*/
function send_response(type, win, val, val2) {
  if (disabled && type != 'specialresponse')
    return;

  var winid = 0;
  if (win)
    winid = win.id;
  var res = { type: type, gen: generation };

  if (type == 'line') {
    res.window = win.id;
    res.value = val;
    if (val2)
      res.terminator = val2;
  }
  else if (type == 'char') {
    res.window = win.id;
    res.value = val;
  }
  else if (type == 'hyperlink') {
    res.window = win.id;
    res.value = val;
  }
  else if (type == 'external') {
    res.value = val;
  }
  else if (type == 'specialresponse') {
    res.response = val;
    res.value = val2;
  }
  else if (type == 'init' || type == 'arrange') {
    res.metrics = val;
  }

  if (!(type == 'init' || type == 'refresh' || type == 'specialresponse')) {
    $.each(windowdic, function(tmpid, win) {
      var savepartial = (type != 'line' && type != 'char') 
                        || (win.id != winid);
      if (savepartial && win.input && win.input.type == 'line'
        && win.inputel && win.inputel.val()) {
        var partial = res.partial;
        if (!partial) {
          partial = {};
          res.partial = partial;
        };
        partial[win.id] = win.inputel.val();
      }
    });
  }

  game_interface.accept(res);
}

/* ---------------------------------------------- */

/* DOM event handlers. */

/* Detect the browser window being resized.
   Unfortunately, this doesn't catch "make font bigger/smaller" changes,
   which ought to trigger the same reaction.)
*/
function evhan_doc_resize(ev) {
  /* We don't want to send a whole flurry of these events, just because
     the user is dragging the window-size around. So we set up a short
     timer, and don't do anything until the flurry has calmed down. */

  if (resize_timer != null) {
    window.clearTimeout(resize_timer);
    resize_timer = null;
  }

  resize_timer = delay_func(0.20, doc_resize_real);
}

/* This executes when no new resize events have come along in the past
   0.20 seconds. (But if the UI is disabled, we delay again, because
   the game can't deal with events yet.)
   ### We really should distinguish between disabling the UI (delay
   resize events) from shutting down the UI (ignore resize events).
 */
function doc_resize_real() {
  resize_timer = null;

  if (disabled) {
    resize_timer = delay_func(0.20, doc_resize_real);
    return;
  }

  var new_metrics = measure_window();
  if (new_metrics.width == current_metrics.width
    && new_metrics.height == current_metrics.height) {
    /* If the metrics haven't changed, skip the arrange event. Necessary on
       mobile webkit, where the keyboard popping up and down causes a same-size
       resize event.

       This is not ideal; it means we'll miss metrics changes caused by
       font-size changes. (Admittedly, we don't have any code to detect those
       anyhow, so small loss.) */
    return;
  }
  current_metrics = new_metrics;
  send_response('arrange', null, current_metrics);
}

/* Event handler: keypress events on input fields.

   Move the input focus to whichever window most recently had it.
*/
function evhan_doc_keypress(ev) {
  if (disabled) {
    return;
  }

  var keycode = 0;
  if (ev) keycode = ev.which;

  if (ev.target.tagName.toUpperCase() == 'INPUT') {
    /* If the focus is already on an input field, don't mess with it. */
    return;
  }

  if (ev.altKey || ev.metaKey || ev.ctrlKey) {
    /* Don't mess with command key combinations. This is not a perfect
       test, since option-key combos are ordinary (accented) characters
       on Mac keyboards, but it's close enough. */
    return;
  }

  if (0) { /*### opera browser?*/
    /* Opera inexplicably generates keypress events for the shift, option,
       and command keys. The keycodes are 16...18. We don't want those
       to focus-and-scroll-down. */
    if (!keycode)
      return;
    if (keycode < 32 && keycode != 13)
      return;
  }

  var win;

  if (windows_paging_count) {
    win = windowdic[last_known_paging];
    if (win) {
      if (!((keycode >= 32 && keycode <= 126) || keycode == 13)) {
        /* If the keystroke is not a printable character (or Enter),
           we return and let the default behavior happen. That lets
           pageup/pagedown/home/end work normally. */
        return;
      }
      ev.preventDefault();
      var frameel = win.frameel;
      /* Scroll the unseen content to the top. */
      frameel.scrollTop(win.topunseen - current_metrics.buffercharheight);
      /* Compute the new topunseen value. */
      var frameheight = frameel.outerHeight();
      var realbottom = last_line_top_offset(frameel);
      var newtopunseen = frameel.scrollTop() + frameheight;
      if (newtopunseen > realbottom)
        newtopunseen = realbottom;
      if (win.topunseen < newtopunseen)
        win.topunseen = newtopunseen;
      if (win.needspaging) {
        /* The scroll-down might have cleared needspaging already. But 
           if not... */
        if (frameel.scrollTop() + frameheight >= frameel.get(0).scrollHeight) {
          win.needspaging = false;
          var moreel = $('#win'+win.id+'_moreprompt', gameport_el);
          if (moreel.length)
            moreel.remove();
          readjust_paging_focus(true);
        }
      }
      return;
    }
  }

  win = windowdic[last_known_focus];
  if (!win)
    return;
  if (!win.inputel)
    return;

  win.inputel.focus();

  if (win.input.type == 'line') {

    if (keycode == 13) {
      /* Grab the Return/Enter key here. This is the same thing we'd do if
         the input field handler caught it. */
      submit_line_input(win, win.inputel.val(), null);
      /* Safari drops an extra newline into the input field unless we call
         preventDefault() here. */
      ev.preventDefault();
      return;
    }

    if (keycode) {
      /* For normal characters, we fake the normal keypress handling by
         appending the character onto the end of the input field. If we
         didn't call preventDefault() here, Safari would actually do
         the right thing with the keystroke, but Firefox wouldn't. */
      /* This is completely wrong for accented characters (on a Mac
         keyboard), but that's beyond my depth. */
      if (keycode >= 32) {
        var val = String.fromCharCode(keycode);
        win.inputel.val(win.inputel.val() + val);
      }
      ev.preventDefault();
      return;
    }

  }
  else {
    /* In character input, we only grab normal characters. Special keys
       should be left to behave normally (arrow keys scroll the window,
       etc.) (This doesn't work right in Firefox, but it's not disastrously
       wrong.) */
    //### grab arrow keys too? They're common in menus.
    var res = null;
    if (keycode == 13)
      res = 'return';
    else if (keycode == key_codes.KEY_BACKSPACE)
      res = 'delete';
    else if (keycode)
      res = String.fromCharCode(keycode);
    if (res) {
      send_response('char', win, res);
    }
    ev.preventDefault();
    return;
  }
}

/* Event handler: mousedown events on windows.

   Remember which window the user clicked in last, as a hint for setting
   the focus. (Input focus and paging focus are tracked separately.)
*/
function evhan_window_mousedown(ev) {
  var winid = ev.data;
  var win = windowdic[winid];
  if (!win)
    return;

  if (win.inputel) {
    last_known_focus = win.id;
    if (0 /*###Prototype.Browser.MobileSafari*/) {
      ev.preventDefault();
      //glkote_log("### focus to " + win.id);
      //### This doesn't always work, blah
      win.inputel.focus();
    }
  }

  if (win.needspaging)
    last_known_paging = win.id;
  else if (win.inputel)
    last_known_paging = 0;
}

/* Event handler: keydown events on input fields (character input)

   Detect the arrow keys, and a few other special keystrokes, for
   character input. We don't grab *all* keys here, because that would
   include modifier keys (shift, option, etc) -- we don't want to
   count those as character input.
*/
function evhan_input_char_keydown(ev) {
  var keycode = 0;
  if (ev) keycode = ev.keyCode; //### ev.which?
  if (!keycode) return true;

  var res = null;

  /* We don't grab Return/Enter in this function, because Firefox lets
     it go through to the keypress handler (even if we try to block it),
     which results in a double input. */

  switch (keycode) {
    case key_codes.KEY_LEFT:
      res = 'left'; break;
    case key_codes.KEY_RIGHT:
      res = 'right'; break;
    case key_codes.KEY_UP:
      res = 'up'; break;
    case key_codes.KEY_DOWN:
      res = 'down'; break;
    case key_codes.KEY_BACKSPACE:
      res = 'delete'; break;
    case key_codes.KEY_ESC:
      res = 'escape'; break;
    case key_codes.KEY_TAB:
      res = 'tab'; break;
    case key_codes.KEY_PAGEUP:
      res = 'pageup'; break;
    case key_codes.KEY_PAGEDOWN:
      res = 'pagedown'; break;
    case key_codes.KEY_HOME:
      res = 'home'; break;
    case key_codes.KEY_END:
      res = 'end'; break;
    case 112:
      res = 'func1'; break;
    case 113:
      res = 'func2'; break;
    case 114:
      res = 'func3'; break;
    case 115:
      res = 'func4'; break;
    case 116:
      res = 'func5'; break;
    case 117:
      res = 'func6'; break;
    case 118:
      res = 'func7'; break;
    case 119:
      res = 'func8'; break;
    case 120:
      res = 'func9'; break;
    case 121:
      res = 'func10'; break;
    case 122:
      res = 'func11'; break;
    case 123:
      res = 'func12'; break;
  }

  if (res) {
    var winid = $(this).data('winid');
    var win = windowdic[winid];
    if (!win || !win.input)
      return true;

    send_response('char', win, res);
    return false;
  }

  return true;
}

/* Event handler: keypress events on input fields (character input)

   Detect all printable characters. (Arrow keys and such don't generate
   a keypress event on all browsers, which is why we grabbed them in
   the keydown handler, above.)
*/
function evhan_input_char_keypress(ev) {
  var keycode = 0;
  if (ev) keycode = ev.which;
  if (!keycode) return false;

  var res;
  if (keycode == 13)
    res = 'return';
  else
    res = String.fromCharCode(keycode);

  var winid = $(this).data('winid');
  var win = windowdic[winid];
  if (!win || !win.input)
    return true;

  send_response('char', win, res);
  return false;
}

/* Event handler: keydown events on input fields (line input)

   Divert the up and down arrow keys to scroll through the command history
   for this window. */
function evhan_input_keydown(ev) {
  var keycode = 0;
  if (ev) keycode = ev.keyCode; //### ev.which?
  if (!keycode) return true;

  if (keycode == key_codes.KEY_UP || keycode == key_codes.KEY_DOWN) {
    var winid = $(this).data('winid');
    var win = windowdic[winid];
    if (!win || !win.input)
      return true;

    if (keycode == key_codes.KEY_UP && win.historypos > 0) {
      win.historypos -= 1;
      if (win.historypos < win.history.length)
        this.value = win.history[win.historypos];
      else
        this.value = '';
    }

    if (keycode == key_codes.KEY_DOWN && win.historypos < win.history.length) {
      win.historypos += 1;
      if (win.historypos < win.history.length)
        this.value = win.history[win.historypos];
      else
        this.value = '';
    }

    return false;
  }
  else if (terminator_key_values[keycode]) {
    var winid = $(this).data('winid');
    var win = windowdic[winid];
    if (!win || !win.input)
      return true;

    if (win.terminators[terminator_key_values[keycode]]) {
      /* This key is listed as a current terminator for this window,
         so we'll submit the line of input. */
      submit_line_input(win, win.inputel.val(), terminator_key_values[keycode]);
      return false;
    }
  }

  return true;
}

/* Event handler: keypress events on input fields (line input)

   Divert the enter/return key to submit a line of input.
*/
function evhan_input_keypress(ev) {
  var keycode = 0;
  if (ev) keycode = ev.which;
  if (!keycode) return true;

  if (keycode == 13) {
    var winid = $(this).data('winid');
    var win = windowdic[winid];
    if (!win || !win.input)
      return true;

    submit_line_input(win, this.value, null);
    return false;
  }

  return true;
}

/* Event handler: focus events on input fields

   Notice that the focus has switched to a line/char input field.
*/
function evhan_input_focus(ev) {
  var winid = ev.data;
  var win = windowdic[winid];
  if (!win)
    return;

  currently_focussed = true;
  last_known_focus = winid;
  last_known_paging = winid;
}

/* Event handler: blur events on input fields

   Notice that the focus has switched away from a line/char input field.
*/
function evhan_input_blur(ev) {
  var winid = ev.data;
  var win = windowdic[winid];
  if (!win)
    return;

  currently_focussed = false;
}

function evhan_window_scroll(ev) {
  var winid = ev.data;
  var win = windowdic[winid];
  if (!win)
    return;

  if (!win.needspaging)
    return;

  var frameel = win.frameel;
  var frameheight = frameel.outerHeight();
  var realbottom = last_line_top_offset(frameel);
  var newtopunseen = frameel.scrollTop() + frameheight;
  if (newtopunseen > realbottom)
    newtopunseen = realbottom;
  if (win.topunseen < newtopunseen)
    win.topunseen = newtopunseen;

  if (frameel.scrollTop() + frameheight >= frameel.get(0).scrollHeight) {
    win.needspaging = false;
    var moreel = $('#win'+win.id+'_moreprompt', gameport_el);
    if (moreel.length)
      moreel.remove();
    readjust_paging_focus(true);
    return;
  }
}

/* Event handler constructor: report a click on a hyperlink
   (This is a factory that returns an appropriate handler function, for
   stupid Javascript closure reasons.)

   Generate the appropriate event for a hyperlink click. Return false,
   to suppress the default HTML action of hyperlinks.
*/
function build_evhan_hyperlink(winid, linkval) {
  return function() {
    var win = windowdic[winid];
    if (!win)
      return false;
    if (!win.reqhyperlink)
      return false;
    send_response('hyperlink', win, linkval);
    return false;
  };
}

/* ---------------------------------------------- */

/* End of GlkOte namespace function. Return the object which will
   become the GlkOte global. */
return {
  version:  '2.0.0',
  init:     glkote_init, 
  update:   glkote_update,
  extevent: glkote_extevent,
  getinterface: glkote_get_interface,
  log:      glkote_log,
  error:    glkote_error
};

}();

/* End of GlkOte library. */
