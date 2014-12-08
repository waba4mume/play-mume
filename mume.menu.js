/* This is an example of how to add custom menu entries using the current crude
 * extension mechanism. */

toolbar_menus[MENU_HELP][MI_SUBMENU].unshift(
    'New to MUME?', 'mume_menu_new();',
    'MUME Help',    'mume_menu_help();',
    'MUME Rules',   'mume_menu_rules();' );

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
