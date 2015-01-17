/* This is an example of how to add custom menu entries using the current crude
 * extension mechanism. */

toolbar_menus[MENU_HELP][MI_SUBMENU].unshift(
    'New to MUME?', 'mume_menu_new();',
    'MUME Help',    'mume_menu_help();',
    'MUME Rules',   'mume_menu_rules();' );

toolbar_menus[MENU_FILE][MI_SUBMENU].unshift(
    'MUME Map', 'open_mume_map_window();' );

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

function open_mume_map_window()
{
    var mapWindow, connectWindows;

    mapWindow = window.open( "map.html", "mume_map", "dialog,minimizable,width=820,height=620" );
    if ( mapWindow === null )
    {
        alert( "Your browser refused to open the map window, you have to allow it "
            +"somewhere near the top right corner of your screen. Look for a "
            +"notification about blocking popups." );
        return;
    }

    mapWindow.addEventListener( "load", function( e )
    {
        var parser, map;

        parser = new MumeXmlParser();
        DecafMUD.instances[0].setTextFilter( parser.filterInput.bind( parser ) );

        map = mapWindow.globalMap;
        parser.on( "tagend", map.processTag.bind( map ) );

        console.log( "The main window will now send data to the map window" );
    } );
}
