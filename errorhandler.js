/*  Play MUME!, a modern web client for MUME using DecafMUD.
    Copyright (C) 2017, Waba.

    This program is free software; you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation; either version 2 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License along
    with this program; if not, write to the Free Software Foundation, Inc.,
    51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA. */

var globalErrorHandlerWasHit = false;

// Log the error in the Apache logs with a dummy URL
window.onerror = function (msg, file_loc, line_no, col_no) {
    col_no = (typeof col_no === "undefined") ? "" : col_no;
    var url = '/mume/play/jserror'
        + '?at=' + encodeURIComponent(file_loc + ":" + line_no + ":" + col_no)
        + "&msg=" + encodeURIComponent(msg);
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.send(null);
    if (!globalErrorHandlerWasHit) {
        alert("Oops! Something went really wrong.\n"
            +"\n"
            +"Please make sure that you are using a supported browser "
            +"(up-to-date Chrome, Firefox, Edge, or IE 11).\n"
            +"\n"
            +"For other cases: the error was logged and will hopefully be fixed... "
            +"Nag Waba if he didn't notice it!\n"
            +"\n"
            +"Technical details: " + msg);
    }
    globalErrorHandlerWasHit = true;
    return false;
}
