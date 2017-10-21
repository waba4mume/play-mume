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
