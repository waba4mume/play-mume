var debugData;

(function() {
'use strict';

var loadMap, mapData, mapDataDescIndex, indexRooms, findRoomByNameDesc,
    buildRoomDisplay,
    ROOM_PIXELS = 48,
    // Indexes into mapData entries (using an array because it may be more
    // efficient to store the whole map).
    MD_X      =  0,
    MD_Y      =  1,
    MD_Z      =  2,
    MD_NORTH  =  3,
    MD_EAST   =  4,
    MD_SOUTH  =  5,
    MD_WEST   =  6,
    MD_UP     =  7,
    MD_DOWN   =  8,
    MD_SECTOR =  9,
    MD_FLAGS  = 10,
    MD_NAME   = 11,
    MD_DESC   = 12;

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

buildRoomDisplay = function( room )
{
    var display;
    display = new PIXI.Graphics();

    // Draw the background
    display.beginFill( 0xa9a9a9, 1 );
    display.drawRect( 0, 0, ROOM_PIXELS, ROOM_PIXELS );
    display.endFill();

    // Draw the borders
    display.lineStyle( 1, 0x000000, 1 );

    [   // direction MD entry, start coords, end coords
        [ MD_NORTH, 0, 0, ROOM_PIXELS, 0 ],
        [ MD_EAST,  ROOM_PIXELS, 0, ROOM_PIXELS, ROOM_PIXELS ],
        [ MD_SOUTH, ROOM_PIXELS, ROOM_PIXELS, 0, ROOM_PIXELS ],
        [ MD_WEST,  0, ROOM_PIXELS, 0, 0 ]
    ].forEach( function( border )
    {
        if ( room[ border[0] ] === null )
        {
            display.moveTo( border[1], border[2] );
            display.lineTo( border[3], border[4] );
        }
    } );

    // Position the room display in its layer
    display.position = new PIXI.Point( room[MD_X] * ROOM_PIXELS, room[MD_Y] * ROOM_PIXELS );

    display.updateCache();
    return display;
}

loadMap = function()
{
    var renderer, mapWindow, stage, layer0;

    indexRooms();

    renderer = PIXI.autoDetectRenderer( 800, 600 );
    mapWindow = window.open( "about:blank", "mume-map", "dialog,minimizable,width=820,height=620" );
    mapWindow.document.body.appendChild( renderer.view );

    stage = new PIXI.Stage( 0x6e6e6e );

    layer0 = new PIXI.Graphics();
    mapData.forEach( function( room )
    {
        layer0.addChild( buildRoomDisplay( room ) );
    } );
    stage.addChild( layer0 );

    renderer.render( stage );

    debugData = [ stage, layer0 ];
}

window.addEventListener( "load", loadMap );

mapData = [
    /* 0 */ [
        5, 5, 0, null, 1, null, null, null, null, 0, 0,
        "Fortune's Delving",
        "A largely ceremonial hall, it was the first mineshaft that led down to what is\n"
        +"now the second level of this Dwarven city. Dwarves hustle and bustle up and\n"
        +"down the great staircase at whose top you now stand. Guards stand watch by the\n"
        +"stairs, scowling at non-Dwarves, and a large sign is etched into the stone\n"
        +"above them. It has been a long time since the eyes of Men or Elves have been\n"
        +"welcome in the strongholds of the Dwarves, and this place is no exception."
    ],
    /* 1 */ [
        6, 5, 0, null, null, null, 1, null, null, 0, 0,
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
