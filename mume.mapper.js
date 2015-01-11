(function() {
'use strict';

var loadMap, mapData, mapDataDescIndex, indexRooms, findRoomByNameDesc,
    buildRoomDisplay, getSectorAssetPath, openMapWindow, globalMapWindow,
    ROOM_PIXELS = 48,
    // Indexes into mapData entries (using an array because it may be more
    // efficient to store the whole map).
    MD_X         =  0,
    MD_Y         =  1,
    MD_Z         =  2,
    MD_NORTH     =  3,
    MD_EAST      =  4,
    MD_SOUTH     =  5,
    MD_WEST      =  6,
    MD_UP        =  7,
    MD_DOWN      =  8,
    MD_SECTOR    =  9,
    MD_MOBFLAGS  = 10,
    MD_LOADFLAGS = 11,
    MD_LIGHT     = 12,
    MD_RIDABLE   = 13,
    MD_NAME      = 14,
    MD_DESC      = 15,
    SECT_UNDEFINED      =  0, // Only for MM2 compatibility...
    SECT_INSIDE         =  1,
    SECT_CITY           =  2,
    SECT_FIELD          =  3,
    SECT_FOREST         =  4,
    SECT_HILLS          =  5,
    SECT_MOUNTAIN       =  6,
    SECT_WATER_SHALLOW  =  7,
    SECT_WATER          =  8,
    SECT_WATER_NOBOAT   =  9,
    SECT_UNDERWATER     = 10,
    SECT_ROAD           = 11,
    SECT_BRUSH          = 12,
    SECT_TUNNEL         = 13,
    SECT_CAVERN         = 14,
    SECT_DEATHTRAP      = 15, // in MUME it's actually a flag
    XXX;

// Uses the JS builtin hash to index rooms.
// Should be fast, but memory-hungry. We might load only a pre-computed
// hash of the room to save memory later. To be tested.
indexRooms = function()
{
    mapDataDescIndex = {};

    var i;
    for ( i = 0; i < mapData.length; ++i )
    {
        var key, room;
        room = mapData[i];
        key = room[MD_NAME] + "\n" + room[MD_DESC];
        mapDataDescIndex[key] = i;
    }
}

// Returns ID or undefined
findRoomByNameDesc = function( name, desc )
{
    var num;
    num = mapDataDescIndex[name + "\n" + desc];
    return num;
}

getSectorAssetPath = function( sector )
{
    return "resources/pixmaps/terrain" + sector + ".png";
}

buildRoomDisplay = function( room )
{
    var display, sector, borders;

    display = new PIXI.DisplayObjectContainer();

    // load a PNG as background (sector type)
    sector = PIXI.Sprite.fromImage( getSectorAssetPath( room[MD_SECTOR] ) );
    sector.height = sector.width = ROOM_PIXELS; // Just in case we got a wrong PNG here
    display.addChild( sector );

    // Draw the borders
    borders = new PIXI.Graphics();
    borders.lineStyle( 1, 0x000000, 1 );

    [   // direction MD entry, start coords, end coords
        [ MD_NORTH, 0, 0, ROOM_PIXELS, 0 ],
        [ MD_EAST,  ROOM_PIXELS, 0, ROOM_PIXELS, ROOM_PIXELS ],
        [ MD_SOUTH, ROOM_PIXELS, ROOM_PIXELS, 0, ROOM_PIXELS ],
        [ MD_WEST,  0, ROOM_PIXELS, 0, 0 ]
    ].forEach( function( border )
    {
        if ( typeof room[ border[0] ] !== "number" )
        {
            borders.moveTo( border[1], border[2] );
            borders.lineTo( border[3], border[4] );
        }
    } );
    display.addChild( borders );

    // Position the room display in its layer
    display.position = new PIXI.Point( room[MD_X] * ROOM_PIXELS, room[MD_Y] * ROOM_PIXELS );

    display.cacheAsBitmap = true;
    return display;
}

openMapWindow = function()
{
    var mapWindow;

    indexRooms();

    // Open a new window and make really sure it's blank
    mapWindow = window.open( "map.html", "mume-map", "dialog,minimizable,width=820,height=620" );
    if ( mapWindow === null )
    {
        alert( "Your browser refused to open the map window, you have to allow it "
            +"somewhere near the top right corner of your screen. Look for a "
            +"notification about blocking popups." );
        return;
    }
    console.log( "mapWindow state: ", mapWindow.document.readyState );
    globalMapWindow = mapWindow; // Hack until I objectify this
    if ( mapWindow.document.readyState === "complete" )
        loadMap();
    else
        mapWindow.addEventListener( "load", loadMap );
}

loadMap = function()
{
    var renderer, stage, layer0, animate;

    // Set the Pixi viewport as the content of that new window
    renderer = PIXI.autoDetectRenderer( 800, 600 );
    if ( globalMapWindow.document.getElementById( "map" ) )
        globalMapWindow.document.body.replaceChild(
            renderer.view,
            globalMapWindow.document.getElementById( "map" ) );
    else
        globalMapWindow.document.body.appendChild( renderer.view );
    renderer.view.id = "map";

    // Add the rooms to a base layer (later we'll need more layers)
    layer0 = new PIXI.DisplayObjectContainer();
    mapData.forEach( function( room )
    {
        layer0.addChild( buildRoomDisplay( room ) );
    } );

    // And set the stage
    stage = new PIXI.Stage( 0x6e6e6e );
    stage.addChild( layer0 );
    animate = function() {
        globalMapWindow.requestAnimationFrame( animate );
        renderer.render( stage );
    };
    globalMapWindow.requestAnimationFrame( animate );

    return;
}

window.addEventListener( "load", openMapWindow );

mapData = [
    /* 0 */ [
        5, 5, 0, null, 1, null, null, null, null,
        SECT_CITY, 0, 0, null, null,
        "Fortune's Delving",
        "A largely ceremonial hall, it was the first mineshaft that led down to what is\n"
        +"now the second level of this Dwarven city. Dwarves hustle and bustle up and\n"
        +"down the great staircase at whose top you now stand. Guards stand watch by the\n"
        +"stairs, scowling at non-Dwarves, and a large sign is etched into the stone\n"
        +"above them. It has been a long time since the eyes of Men or Elves have been\n"
        +"welcome in the strongholds of the Dwarves, and this place is no exception."
    ],
    /* 1 */ [
        6, 5, 0, null, null, null, 1, null, null,
        SECT_INSIDE, 0, 0, null, null,
        "Trader's Way",
        "This wide way has been modelled as an avenue, in the style of Elves and Men. To\n"
        +"the sides are shops selling all sorts of goods, bustling with Dwarves and the\n"
        +"occasional Man or Elf. Between the shops bright outdoor scenes are painted and\n"
        +"weary travellers may rest on benches along the way. On the ceiling high above\n"
        +"can be seen a bright blue sky dotted with puffy white clouds. This part of the\n"
        +"way is particularly busy, as it intersects the main path from the outside to\n"
        +"the deeper parts of the Dwarven caves."
    ]
];

})();
