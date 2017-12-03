toolbar_menus[MENU_HELP][MI_SUBMENU].unshift(
    'New to MUME?', 'mume_menu_new();',
    'MUME Help',    'mume_menu_help();',
    'MUME Rules',   'mume_menu_rules();' );

toolbar_menus[MENU_HELP][MI_SUBMENU].push(
    'About Map',     'mume_menu_about_map();',
    'Map(per) Bug?', 'mume_menu_map_bug();', );

toolbar_menus[MENU_OPTIONS][MI_SUBMENU].unshift(
    'Detach Map', 'open_mume_map_window();' );

function mume_menu_new()
{
    window.open('http://mume.org/newcomers.php', 'mume_new_players');
}

function mume_menu_help()
{
    window.open('http://mume.org/help.php', 'mume_help');
}

function mume_menu_rules()
{
    window.open('http://mume.org/rules.php', 'mume_rules');
}

function mume_menu_about_map()
{
    alert(
        "Play MUME!, a modern web client for MUME using DecafMUD, is brought to you by Waba,\n" +
        "based on the idea and graphics of MMapper (by Alve, Caligor, and Jahara).\n" +
        "\n" +
        "Both are Free and Open Source (GPLv2+).\n" +
        "\n" +
        "Fork Play MUME! on Github: https://github.com/waba4mume/play-mume/\n" +
        "\n" +
        "The map data is covered by a separate license." );
}

function mume_menu_map_bug()
{
    window.open( 'https://github.com/waba4mume/play-mume/issues/new', 'mume_map_bug' );
}

function open_mume_map_window()
{
    var where, url;
    if ( globalMap && globalMap.pathMachine.here )
        where = globalMap.pathMachine.here.x + "," +
            globalMap.pathMachine.here.y + "," +
            globalMap.pathMachine.here.z;

    url = where ? "map.html#" + where : "map.html";
    globalMapWindow = window.open( url, "mume_map", "dialog,minimizable,width=820,height=620" );
    if ( globalMapWindow === null )
    {
        alert( "Your browser refused to open the map window, you have to allow it "
            +"somewhere near the top right corner of your screen. Look for a "
            +"notification about blocking popups." );
        return;
    }

    if ( globalSplit )
    {
        globalSplit.collapse( 1 );
        canvasFitParent();
    }
}
