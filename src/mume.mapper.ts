(function( global ) {

const ROOM_PIXELS = 48;
const SECT_UNDEFINED      =  0;
const SECT_INSIDE         =  1;
const SECT_CITY           =  2;
const SECT_FIELD          =  3;
const SECT_FOREST         =  4;
const SECT_HILLS          =  5;
const SECT_MOUNTAIN       =  6;
const SECT_WATER_SHALLOW  =  7;
const SECT_WATER          =  8;
const SECT_WATER_NOBOAT   =  9;
const SECT_UNDERWATER     = 10;
const SECT_ROAD           = 11;
const SECT_BRUSH          = 12;
const SECT_TUNNEL         = 13;
const SECT_CAVERN         = 14;
const SECT_DEATHTRAP      = 15;
const SECT_COUNT          = 16;
const MAP_DATA_PATH = "mapdata/v1/";

/* Like JQuery.when(), but the master Promise is resolved only when all
 * promises are resolved or rejected, not at the first rejection. */
function whenAll( deferreds: Array<JQueryPromise<any>> )
{
    let master: JQueryDeferred<any> = jQuery.Deferred();

    if ( deferreds.length === 0 )
        return master.resolve();

    let pending = new Set<JQueryPromise<any>>();
    for ( let dfr of deferreds )
        pending.add( dfr );

    for ( let dfr of deferreds )
    {
        dfr.always( () =>
        {
            pending.delete( dfr );
            if ( pending.size === 0 )
                master.resolve();
        } );
    }

    return master;
}

/* Like map.keys(), but as an Array and IE-compatible.
 */
function mapKeys<T, U>( map: Map<T, U> )
{
    let keys: Array<T> = [];
    map.forEach( function( value, key ) { keys.push( key ); } );
    return keys;
};

// Adapted from MMapper2: the result must be identical for the hashes to match
function translitUnicodeToAsciiLikeMMapper( unicode: string ): string
{
    const table = [
        /*192*/ 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'C', 'E', 'E', 'E', 'E', 'I', 'I', 'I', 'I',
        /*208*/ 'D', 'N', 'O', 'O', 'O', 'O', 'O', 'x', 'O', 'U', 'U', 'U', 'U', 'Y', 'b', 'B',
        /*224*/ 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'c', 'e', 'e', 'e', 'e', 'i', 'i', 'i', 'i',
        /*248*/ 'o', 'n', 'o', 'o', 'o', 'o', 'o', ':', 'o', 'u', 'u', 'u', 'u', 'y', 'b', 'y', ];

    let ascii = "";
    for ( let charString of unicode )
    {
        let ch = charString.charCodeAt( 0 );
        if (ch > 128)
        {
          if (ch < 192)
            ascii += "z"; // sic
          else
            ascii += table[ ch - 192 ];
        }
        else
        {
            ascii += charString;
        }
    }

    return ascii;
}


/* This is the "entry point" to this library for the rest of the code. */
class MumeMap
{
    public mapData: MumeMapData;
    public mapIndex: MumeMapIndex;
    public display: MumeMapDisplay;
    public pathMachine: MumePathMachine;
    public processTag: any;
    public static debugInstance: MumeMap;

    constructor( containerElementName: any )
    {
        this.mapData = new MumeMapData();
        this.mapIndex = new MumeMapIndex();
        this.display = new MumeMapDisplay( containerElementName, this.mapData );

        this.pathMachine = new MumePathMachine( this.mapData, this.mapIndex );
        this.processTag = this.pathMachine.processTag.bind( this.pathMachine );

        MumeMap.debugInstance = this;
    }

    public load(): void
    {
        this.mapData.load().done( () =>
        {
            this.display.loadMap();
            $(this.pathMachine).on( MumePathMachine.SIG_MOVEMENT, this.onMovement.bind( this ) );
        } );
    }

    public onMovement( event: any, x: number, y: number ): void
    {
        this.display.repositionHere( x, y ).done( () =>
        {
            console.log("refreshing the display");
            this.display.refresh();
        } );
    }
}





/* Analogy to MMapper2's path machine, although ours is a currently just a
 * naive room+desc exact search with no "path" to speak of.
 */
class MumePathMachine
{
    public static readonly SIG_MOVEMENT = "movement";

    public mapData: MumeMapData;
    public mapIndex: MumeMapIndex;
    public roomName: string | null;

    constructor( mapData: MumeMapData, mapIndex: MumeMapIndex )
    {
        this.mapData = mapData;
        this.mapIndex = mapIndex;
        this.roomName = null;
    }

    /* This receives an event from MumeXmlParser when it encounters a closing tag.
     * */
    public processTag( event: any, tag: any ): void
    {
        console.log( "MumePathMachine processes tag " + tag.name );
        if ( tag.name === "name" )
            this.roomName = tag.text;
        else if ( tag.name === "description" )
        {
            if ( this.roomName )
            {
                this.enterRoom( this.roomName, tag.text );
                this.roomName = null;
            }
            else
            {
                throw "Bug: the MumePathMachine got a room description but no room name: " +
                    tag.text.substr( 0, 50 ) + "...";
            }
        }
        else if ( tag.name === "room" )
        {
            this.roomName = null;
        }
    }

    /* Internal function called when we got a complete room. */
    private enterRoom( name: string, desc: string ): void
    {
        this.mapIndex.findPosByNameDesc( name, desc )
            .done( ( coordinates: any ) =>
            {
                $(this).triggerHandler( MumePathMachine.SIG_MOVEMENT, coordinates[0] );
            } );
    }
}



/* Queries and caches the server-hosted index of rooms.
 * For v1 format, that's a roomname+roomdesc => coords index, 2.4MB total,
 * split into 10kB JSON chunks.
 */
class MumeMapIndex
{
    // This is a vast simplification of course...
    private static readonly ANY_ANSI_ESCAPE =  /\x1B\[[^A-Za-z]+[A-Za-z]/g;

    private cache: Map<string, any>;
    private cachedChunks: Set<string>;

    constructor()
    {
        this.cache = new Map<string, any>();
        this.cachedChunks = new Set<string>();
    }

    /* Normalize into text that should match what MMapper used to produce the
     * name+desc hashes.
     */
    public static normalizeString( input: string )
    {
        // MMapper indexed the plain text without any escape, obviously.
        let text = input.replace( MumeMapIndex.ANY_ANSI_ESCAPE, '' );

        // MMapper applies these conversions to ensure the hashes in the index
        // are resilient to trivial changes.
        return translitUnicodeToAsciiLikeMMapper( text )
            .replace( / +/g, " " )
            .replace( / *\r?\n/g, "\n" );
    }

    /* Returns a hash of the name+desc that identifies the chunk of the name+desc
     * index we want from the server. This algorithm must be identical to what
     * MMapper uses for this version of the webmap format.
     */
    public static hashNameDesc( name: string, desc: string )
    {
        let normName = MumeMapIndex.normalizeString( name );
        let normDesc = MumeMapIndex.normalizeString( desc );
        let namedesc = normName + "\n" + normDesc;

        let hash = SparkMD5.hash( namedesc );
        return hash;
    }

    private updateCache( json: any )
    {
        var hash, oldSize, sizeIncrease, jsonSize;

        oldSize = this.cache.size;

        for ( hash in json )
            if ( json.hasOwnProperty( hash ) )
                this.cache.set( hash, json[ hash ] );

        sizeIncrease = this.cache.size - oldSize;
        jsonSize = Object.keys( json ).length;

        console.log( "MumeMapIndex: cached %d new entries (%d total)",
            sizeIncrease, this.cache.size, jsonSize );

        if ( sizeIncrease != jsonSize )
            console.error( "MumeMapIndex: stray index entries in %O?", json );
    }

    // Private helper for findPosByNameDesc().
    private findPosByNameDescCached( name: string, desc: string, result: any, hash: any )
    {
        var coordinates, roomInfo;

        coordinates = this.cache.get( hash );
        roomInfo = { name: name, desc: desc, hash: hash, };
        if ( coordinates === undefined )
        {
            console.log( "MumeMapIndex: unknown room %s (%O)", name, roomInfo );
            result.reject();
        }
        else
        {
            console.log( "MumeMapIndex: found %s (%O) in %O", name, roomInfo, coordinates );
            result.resolve( coordinates );
        }
        return result;
    }

    /* This may be asynchronous if the index chunk has not been downloaded yet, so
     * the result is a jQuery Deferred.
     */
    public findPosByNameDesc( name: string, desc: string ): any
    {
        let hash = MumeMapIndex.hashNameDesc( name, desc );
        let result = jQuery.Deferred();

        // Shortcut if we already have that index chunk in cache
        let chunk = hash.substr( 0, 2 );
        if ( this.cachedChunks.has( chunk ) )
            return this.findPosByNameDescCached( name, desc, result, hash );

        console.log( "Downloading map index chunk " + chunk );
        let url = MAP_DATA_PATH + "roomindex/" + chunk + ".json";
        jQuery.getJSON( url )
            .done( ( json: any ) =>
            {
                this.cachedChunks.add( chunk );
                this.updateCache( json );
                this.findPosByNameDescCached( name, desc, result, hash );
            } )
            .fail( function( jqxhr, textStatus, error )
            {
                console.error( "Loading map index chunk %s failed: %s, %O", url, textStatus, error );
                result.reject();
            } );

        return result;
    }
}


/* This is a RoomCoords shifted by metaData.minX/Y/Z to fit a zero-based Array. */
class ZeroedRoomCoords
{
    private preventDuckTyping: any;

    public x: number;
    public y: number;
    public z: number;

    constructor( x: number, y: number, z: number )
    {
        this.x = x;
        this.y = y;
        this.z = z;
    }
}

/* Room coordinates, comprised in metaData.minX .. maxX etc. */
class RoomCoords
{
    private preventDuckTyping: any;

    public x: number;
    public y: number;
    public z: number;

    constructor( x: number, y: number, z: number )
    {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    public toString(): string
    {
        return `RoomCoords(${this.x}, ${this.y}, ${this.z})`;
    }
}

/* Stores stuff in a x/y/z-indexed 3D array. The coordinates must be within the
 * minX/maxX/etc bounds of the metaData.
 */
class SpatialIndex<T>
{
    private readonly metaData: MapMetaData;
    private data: Array<Array<Array<T>>>;

    constructor( metaData: MapMetaData )
    {
        this.metaData = metaData;

        // Hopefully, JS' sparse arrays will make this memory-efficient.
        this.data = new Array( this.metaData.maxX - this.metaData.minX );
    }

    /* Private helper to get 0-based coordinates from whatever MM2 provided */
    private getZeroedCoordinates( pos: RoomCoords ): ZeroedRoomCoords
    {
        return new ZeroedRoomCoords(
            pos.x - this.metaData.minX,
            pos.y - this.metaData.minY,
            pos.z - this.metaData.minZ,
        );
    }

    public set( c: RoomCoords, what: T ): void
    {
        let zero = this.getZeroedCoordinates( c );

        if ( this.data[ zero.x ] === undefined )
            this.data[ zero.x ] = new Array( this.metaData.maxY - this.metaData.minY );

        if ( this.data[ zero.x ][ zero.y ] === undefined )
            this.data[ zero.x ][ zero.y ] = [];

        this.data[ zero.x ][ zero.y ][ zero.z ] = what;
    };

    /* Public. */
    public get( c: RoomCoords ): T | null
    {
        let zero = this.getZeroedCoordinates( c );

        if ( this.data[ zero.x ] !== undefined &&
                this.data[ zero.x ][ zero.y ] !== undefined &&
                this.data[ zero.x ][ zero.y ][ zero.z ] !== undefined )
        {
            return this.data[ zero.x ][ zero.y ][ zero.z ];
        }
        else
        {
            return null;
        }
    };
}




// This is what we load from the server.
class MapMetaData
{
    /* The default values are never used and only make sure we can compare the
     * declared vs. downloaded properties at runtime. */
    directions: Array<number> = [];
    maxX: number = 0;
    maxY: number = 0;
    maxZ: number = 0;
    minX: number = 0;
    minY: number = 0;
    minZ: number = 0;
    roomsCount: number = 0;
}

// This is what we load from the server.
class RoomData
{
    [key: string] : any;

    /* The default values are never used and only make sure we can compare the
     * declared vs. downloaded properties at runtime. */
    name: string = "";
    desc: string = "";
    id: number = 0;
    x: number = 0;
    y: number = 0;
    z: number = 0;
    exits: Array<any> = [];
    // ...
}

class Room
{
    public data: RoomData;

    constructor( data: RoomData )
    {
        this.data = data;
    }

    public coords(): RoomCoords
    {
        return new RoomCoords( this.data.x, this.data.y, this.data.z );
    }
}

/* Stores map data (an array of room structures, exposed as .data) and provides
 * an indexing feature. */
class MumeMapData
{
    /* These zones are currently in-memory. */
    private cachedZones = new Set<string>();
    /* These zones are known not to exist on the server. */
    private nonExistentZones = new Set<string>();
    /* Publicly readable, guaranteed to hold REQUIRED_META_PROPS. */
    public metaData: MapMetaData | null;
    /* Private in-memory room cache. */
    private rooms: SpatialIndex<Room> | null;

    // Arda is split into JSON files that wide.
    private static readonly ZONE_SIZE = 20;

    /* Initiates loading the external JSON map data.
     * Returns a JQuery Deferred that can be used to execute further code once done.
     */
    public load(): JQueryDeferred<void>
    {
        let result = jQuery.Deferred();

        jQuery.getJSON( MAP_DATA_PATH + "arda.json" )
            .done( ( json: any ) =>
            {
                console.log( "Map metadata loaded" );
                if ( ! this.setMetadata( json ) )
                    result.reject();
                else
                    result.resolve();
            } )
            .fail( function( jqxhr, textStatus, error )
            {
                console.error( "Loading metadata failed: %s, %O", textStatus, error );
                result.reject();
            } );

        return result;
    };

    /* Private helper that checks the validity of json */
    private setMetadata( json: any ): boolean
    {
        let missing = new Array<string>();
        for ( let prop in new MapMetaData() )
            if ( !json.hasOwnProperty( prop ) )
                missing.push( prop );

        if ( missing.length !== 0 )
        {
            console.error( "Missing properties in loaded metadata: %O", missing );
            return false;
        }

        this.metaData = <MapMetaData>json;
        this.rooms = new SpatialIndex<Room>( json );

        return true;
    };

    /* Private helper that feeds the in-memory cache. */
    private setCachedRoom( room: Room ): void
    {
        this.rooms.set( room.coords(), room );
    };

    /* Returns a room from the in-memory cache or null if not found. Does not
     * attempt to download the zone if it's missing from the cache.
     */
    public getRoomAtCached( c: RoomCoords ): any
    {
        let room = this.rooms.get( c );

        if ( room != null )
        {
            /*console.log( "MumeMapData found room %s (%d) for coords %d,%d,%d",
                room.name, room.id, x, y, z );*/
            return room;
        }
        else
        {
            /*console.log( "MumeMapData did not find a room for coords %d,%d,%d",
                x, y, z );*/
            return null;
        }
    };

    private getRoomResultAtCached( c: RoomCoords,
        result: JQueryDeferred<any> ): JQueryDeferred<any>
    {
        let room = this.getRoomAtCached( c );
        if ( room === null )
            return result.reject();
        else
            return result.resolve( room );
    };

    /* Stores a freshly retrieved JSON zone into the in-memory cache. Returns
     * the rooms added to the cache. */
    private cacheZone( zone: string, json: any ): Array<Room>
    {
        if ( !Array.isArray( json ) )
        {
            console.error( "Expected to find an Array for zone %s, got %O", zone, json );
            return [];
        }

        let cached = new Array<Room>();
        for ( let i = 0; i < json.length; ++i )
        {
            let rdata: RoomData = json[ i ];

            let missing = new Array<string>();
            for ( let prop in new RoomData() )
                if ( !rdata.hasOwnProperty( prop ) )
                    missing.push( prop );

            if ( missing.length !== 0 )
            {
                console.error( "Missing properties %O in room #%d of zone %s", missing, i, zone );
                return cached; // but do not mark the zone as cached - we'll retry it
            }

            let room = new Room( rdata );
            this.setCachedRoom( room );
            cached.push( room );
        }

        console.log( "MumeMapData cached %d rooms for zone %s", cached, zone );
        this.cachedZones.add( zone );
        return cached;
    };

    /* Returns the x,y zone for that room's coords, or null if out of the map.
     */
    public getRoomZone( x: number, y: number ): string | null
    {
        if ( x < this.metaData.minX || x > this.metaData.maxX ||
                y < this.metaData.minY || y > this.metaData.maxY )
            return null;

        let zoneX = x - ( x % MumeMapData.ZONE_SIZE );
        let zoneY = y - ( y % MumeMapData.ZONE_SIZE );
        let zone = zoneX + "," + zoneY;

        return zone;
    };

    /* Private. */
    private downloadAndCacheZone( zone: string ): JQueryDeferred<void>
    {
        let result = jQuery.Deferred();

        console.log( "Downloading map zone %s", zone );
        let url = MAP_DATA_PATH + "zone/" + zone + ".json";
        jQuery.getJSON( url )
            .done( ( json ) =>
            {
                this.cacheZone( zone, json );
                result.resolve();
            } )
            .fail( function( jqXHR, textStatus, error )
            {
                if ( jqXHR.status === 404 )
                    console.log( "Map zone %s does not exist: %s, %O", url, textStatus, error );
                    // Not an error: zones without data simply don't get output
                else
                    console.error( "Downloading map zone %s failed: %s, %O", url, textStatus, error );
                result.reject();
            } );

        return result;
    };

    /* Fetches a room from the cache or the server. Returns a jQuery Deferred. */
    public getRoomAt( c: RoomCoords ): JQueryDeferred<any>
    {
        let result = jQuery.Deferred();

        let zone = this.getRoomZone( c.x, c.y );
        if ( zone === null || this.nonExistentZones.has( zone ) )
            return result.reject();

        if ( this.cachedZones.has( zone ) )
            return this.getRoomResultAtCached( c, result );

        this.downloadAndCacheZone( zone )
            .done( () =>
            {
                this.getRoomResultAtCached( c, result );
            } );

        return result;
    };

    /* Fetches rooms at an Array of x/y/z coords from the cache or the server.
     * Returns arrays of rooms through a jQuery Deferred. Partial results are
     * returned as soon as the rooms are available as notify()cations, and the
     * complete array of rooms is also returned when the Promise is resolved.
     * Rooms that do not exist are not part of the results.
     */
    public getRoomsAt( coordinates: Array<RoomCoords> ): JQueryPromise<Array<Room>>
    {
        let result = jQuery.Deferred();
        let downloads: Array<{ zone: string, dfr: JQueryXHR }> = [];
        let downloadDeferreds: Array<JQueryXHR> = [];
        let zonesNotInCache = new Map<string, Set<RoomCoords>>();
        let roomsInCache: Array<Room> = [];
        let roomsDownloaded: Array<Room> = [];

        // Sort coordinates into rooms in cache and rooms needing a download
        for ( let coords of coordinates )
        {
            let zone = this.getRoomZone( coords.x, coords.y );
            if ( zone === null )
                continue;

            if ( this.nonExistentZones.has( zone ) )
            {
                // Do nothing if the zone doesn't exist on the server
            }
            else if ( !this.cachedZones.has( zone ) )
            {
                let zoneCoords = zonesNotInCache.get( zone );
                if ( zoneCoords )
                    zoneCoords.add( coords );
                else
                {
                    zoneCoords = new Set<RoomCoords>();
                    zoneCoords.add( coords );
                    zonesNotInCache.set( zone, zoneCoords );

                    console.log( "Downloading map zone %s for room %d,%d", zone, coords.x, coords.y );
                    const url = MAP_DATA_PATH + "zone/" + zone + ".json";
                    let deferred = jQuery.getJSON( url );
                    downloads.push( { zone: zone, dfr: deferred } );
                    downloadDeferreds.push( deferred );
                }
            }
            else
            {
                const room = this.getRoomAtCached( coords );
                if ( room != null )
                    roomsInCache.push( room );
            }
        }

        // Return cached rooms immediatly through a notify
        result.notify( roomsInCache );

        // Async-download the rest (this is out of first for() for legibility only)
        for ( let download of downloads )
        {
            download.dfr
                .done( ( json: any ) =>
                {
                    console.log( "Zone %s downloaded", download.zone );
                    let neededCoords = zonesNotInCache.get( download.zone );
                    if ( neededCoords == undefined )
                        return console.error( "Bug: inconsistent download list" );

                    let neededCoordsStr = new Set<string>(); // Equivalent Coords are not === equal
                    neededCoords.forEach( ( c ) => neededCoordsStr.add( c.toString() ) );

                    let downloaded = this.cacheZone( download.zone, json );
                    let neededRooms = downloaded
                        .filter( ( r ) => neededCoordsStr.has( r.coords().toString() ) );

                    // Send the batch of freshly downloaded rooms
                    roomsDownloaded.push( ...neededRooms );
                    result.notify( neededRooms );
                } )
                .fail( ( dfr: JQueryXHR, textStatus: string, error: string ) =>
                {
                    if ( dfr.status === 404 )
                    {
                        this.nonExistentZones.add( download.zone );
                        console.log( "Map zone %s does not exist: %s, %O", download.zone, textStatus, error );
                        // Not an error: zones without data simply don't get output
                    }
                    else
                        console.error( "Downloading map zone %s failed: %s, %O", download.zone, textStatus, error );
                } );
        }

        // Return the whole batch when done
        let allRooms = roomsInCache.concat( roomsDownloaded );
        whenAll( downloadDeferreds ).done( () => result.resolve( allRooms ) );

        return result;
    }
}





/* Renders mapData into a DOM placeholder identified by containerElementName.
 */
class MumeMapDisplay
{
    private mapData: MumeMapData;
    private containerElementName: string;
    private roomDisplays: SpatialIndex<PIXI.Container>;

    // PIXI elements
    private herePointer: PIXI.Container;
    private stage: PIXI.Container;
    private layer0: PIXI.Container;
    private renderer: PIXI.SystemRenderer;

    constructor( containerElementName: string, mapData: MumeMapData )
    {
        this.mapData = mapData;
        this.containerElementName = containerElementName;
    }

    /* Installs the viewport into the DOM and starts loading textures etc (assets).
     * The loading continues in background, after which buildMapDisplay() is
     * called. */
    public loadMap(): void
    {
        var stub;

        // We need the metaData to be loaded to init the SpatialIndex.
        this.roomDisplays = new SpatialIndex( this.mapData.metaData );

        // Set the Pixi viewport as the content of that new window
        this.stage = new PIXI.Container();
        this.renderer = PIXI.autoDetectRenderer( 800, 600 );
        this.renderer.backgroundColor = 0x6e6e6e;
        stub = document.getElementById( this.containerElementName );
        stub.parentElement.replaceChild( this.renderer.view, stub );
        this.renderer.view.id = this.containerElementName;

        // Start loading assets
        PIXI.loader.add( MumeMapDisplay.getAllAssetPaths() );
        PIXI.loader.load( this.buildMapDisplay.bind( this ) );

        return;
    };

    /* Called when all assets are available. Constructs the graphical structure
     * (layers etc) used for rendering and throw all that at the rendering layer
     * (Pixi lib). */
    public buildMapDisplay(): void
    {
        var map;

        // Everything belongs to the map, so we can move it around to emulate
        // moving the viewport
        map = new PIXI.Container();

        // Add the rooms to a base layer (later we'll need more layers)
        this.layer0 = new PIXI.Container();
        map.addChild( this.layer0 );

        // Add the current room yellow square
        this.herePointer = MumeMapDisplay.buildHerePointer();
        this.herePointer.visible = false;
        map.addChild( this.herePointer );

        // And set the stage
        this.stage.addChild( map );
        this.refresh();

        return;
    };

    private static getSectorAssetPath( sector: number ): string
    {
        return "resources/pixmaps/terrain" + sector + ".png";
    };

    private static getAllAssetPaths(): Array<String>
    {
        let paths: Array<String> = [];
        for ( let i = SECT_UNDEFINED; i < SECT_COUNT; ++i )
            paths.push( MumeMapDisplay.getSectorAssetPath( i ) );
        return paths;
    };

    /* Returns the graphical structure for a single room for rendering (base
     * texture, walls, flags etc). */
    private static buildRoomDisplay( room: Room ): PIXI.Container
    {
        let display = new PIXI.Container();

        // load a PNG as background (sector type)
        let imgPath = MumeMapDisplay.getSectorAssetPath( room.data.sector );
        let sector = new PIXI.Sprite( PIXI.loader.resources[ imgPath ].texture );
        sector.height = sector.width = ROOM_PIXELS; // Just in case we got a wrong PNG here
        display.addChild( sector );

        // Draw the borders
        let borders = new PIXI.Graphics();
        borders.lineStyle( 2, 0x000000, 1 );

        [   // direction MD entry, start coords, end coords
            [ "north", 0, 0, ROOM_PIXELS, 0 ],
            [ "east",  ROOM_PIXELS, 0, ROOM_PIXELS, ROOM_PIXELS ],
            [ "south", ROOM_PIXELS, ROOM_PIXELS, 0, ROOM_PIXELS ],
            [ "west",  0, ROOM_PIXELS, 0, 0 ]
        ].forEach( function( border: [string, number, number, number, number] )
        {
            // XXX: room["dir"] syntax may break some Javascript engine
            // optimizations, test it (with a complete map) and refactor if
            // needed.
            if ( typeof room.data[ border[0] ] !== "number" )
            {
                borders.moveTo( border[1], border[2] );
                borders.lineTo( border[3], border[4] );
            }
        } );
        display.addChild( borders );

        // Position the room display in its layer
        display.position = new PIXI.Point( room.data.x * ROOM_PIXELS, room.data.y * ROOM_PIXELS );
        /*console.log( "MumeMapDisplay added room %s (%d,%d) in PIXI at local:%O, global:%O",
            room.data.name, room.data.x, room.data.y, display.position, display.getGlobalPosition() );*/

        display.cacheAsBitmap = true;
        return display;
    };

    /* Returns the graphical structure for the yellow square that shows the current
     * position to the player. */
    public static buildHerePointer(): PIXI.Graphics
    {
        var square, size, offset;

        size = ROOM_PIXELS * 1.4;
        offset = ( size - ROOM_PIXELS ) / 2;

        square = new PIXI.Graphics();
        square.lineStyle( 2, 0xFFFF00, 1 );
        square.drawRect( -offset, -offset, size, size );

        square.beginFill( 0x000000, 0.1 );
        square.drawRect( -offset, -offset, size, size );
        square.endFill();

        return square;
    };

    /* Repositions the HerePointer (yellow square), centers the view, and fetches
     * nearby rooms for Pixi. Does not refresh the view.
     */
    public repositionHere( x: number, y: number ): JQueryPromise<Array<Room>>
    {
        this.herePointer.position = new PIXI.Point( x * ROOM_PIXELS, y * ROOM_PIXELS );
        this.herePointer.visible = true;

        // Scroll to make the herePointer visible
        let pointerGlobalPos = this.herePointer.toGlobal( new PIXI.Point( 0, 0 ) );
        this.stage.x += - pointerGlobalPos.x + 400;
        this.stage.y += - pointerGlobalPos.y + 300;
        console.log( "Recentering view to (r) %d,%d, (px) %d,%d", x, y, this.stage.x, this.stage.y );

        let coordinates: Array<RoomCoords> = [];
        for ( let i = x - 20; i < x + 20; ++i )
        {
            for ( let j = y - 20; j < y + 20; ++j )
            {
                let c = new RoomCoords( i, j, 0 );
                if ( this.roomDisplays.get( c ) == null )
                    coordinates.push( c );
            }
        }

        let result = this.mapData.getRoomsAt( coordinates )
            .progress( ( rooms: Array<Room> ) =>
            {
                console.log( "repositionHere progress, %d rooms", rooms.length );
                for ( let k = 0; k < rooms.length; ++k )
                {
                    let room = rooms[k];
                    let display = MumeMapDisplay.buildRoomDisplay( room );
                    if ( this.roomDisplays.get( room.coords() ) == null )
                    {
                        this.roomDisplays.set( room.coords(), display );
                        this.layer0.addChild( display );
                    }
                }
            } );

        return result;
    };

    public refresh(): void
    {
        this.renderer.render( this.stage );
    };
}



interface MumeXmlParserTag
{
    name: string;
    attr: string;
    text: string;
}


/* Filters out the XML-like tags that MUME can send in "XML mode", and sends
 * them as events instead.
 *
 * Sample input:
 * <xml>XML mode is now on.
 * <prompt>!f- CW&gt;</prompt>f
 * You flee head over heels.
 * You flee north.
 * <movement dir=north/>
 * <room><name>A Flat Marsh</name>
 * <description>The few, low patches of tangled rushes add a clear tone to the otherwise sombre
 * colour of this flat marshland. Some puddles are scattered behind them, where
 * there are many pebbles of varying sizes. Most of these pebbles have been
 * covered by a thin layer of dark, green moss.
 * </description>A large green shrub grows in the middle of a large pool of mud.
 * </room><exits>Exits: north, east, south.
 * </exits>
 * <prompt>!%- CW&gt;</prompt>cha xml off
 * </xml>XML mode is now off.
 *
 * Matching event output:
 * { name: "prompt",      attr: "",          text: "!f- CW>" }
 * { name: "movement",    attr: "dir=north", text: "" }
 * { name: "name",        attr: "",          text: "A Flat Marsh" }
 * { name: "description", attr: "",          text: "The few... sombre\n...moss.\n" }
 * { name: "room",        attr: "",          text: "A large green...mud.\n" }
 * { name: "exits",       attr: "",          text: "Exits: north, east, south.\n" }
 * { name: "prompt",      attr: "",          text: "!%- CW>" }
 * { name: "xml",         attr: "",          text: "" }
 *
 * Tag hierarchy does not carry a lot of meaning and is not conveyed in the
 * events sent. The text of the XML is always empty as it would be useless but
 * grow huge over the course of the session.
 *
 * At the time of writing, MUME emits at most 1 attribute for tags encountered
 * during mortal sessions, and never quotes it.
 *
 * One registers to events by calling:
 * parser.on( MumeXmlParser.SIG_TAG_END, function( tag ) { /* Use tag.name etc here *./ } );
 */
class MumeXmlParser
{
    private tagStack: Array<MumeXmlParserTag>;
    private plainText: string;

    constructor( decaf: any )
    {
        this.clear();
    }

    public static readonly SIG_TAG_END = "tagend";

    public clear(): void
    {
        this.tagStack = [];
        this.plainText = "";
    };

    public connected(): void
    {
        this.clear();
    }

    private topTag(): MumeXmlParserTag | null
    {
        if ( this.tagStack.length == 0 )
            return null;
        else
            return this.tagStack[ this.tagStack.length - 1 ];
    };

    private resetPlainText(): string
    {
        let plainText = this.plainText;
        this.plainText = "";

        return plainText;
    };

    /* Matches a start or end tag and captures the following:
     * 1. any text preceeding the tag
     * 2. "/" if this is an end tag
     * 3. tag name
     * 4. any attributes
     * 5. "/" if this is a leaf tag (IOW, no end tag will follow).
     * 6. any text following the tag
     *
     * Pardon the write-only RE, JavaScript doesn't have /x.
     */
    private static readonly TAG_RE = /([^<]*)<(\/?)(\w+)(?: ([^/>]+))?(\/?)>([^<]*)/g;

    private static decodeEntities( text: string ): string
    {
        var decodedText;

        decodedText = text
            .replace( /&lt;/g, "<" )
            .replace( /&gt;/g, ">" )
            .replace( /&amp;/g, "&" );

        return decodedText;
    };

    /* Takes text with pseudo-XML as input, returns plain text and emits events.
     */
    public filterInputText( input: string ): string
    {
        var matches, isEnd, isLeaf, tagName, attr, textBefore, textAfter, matched;

        while ( ( matches = MumeXmlParser.TAG_RE.exec( input ) ) !== null )
        {
            textBefore = matches[1];
            isEnd      = matches[2];
            tagName    = matches[3];
            attr       = matches[4];
            isLeaf     = matches[5];
            textAfter  = matches[6];

            matched = true;

            if ( textBefore )
            {
                this.pushText( textBefore );
            }

            if ( isLeaf )
            {
                this.startTag( tagName, attr );
                this.endTag( tagName );
            }
            else if ( isEnd )
            {
                this.endTag( tagName );
            }
            else
            {
                this.startTag( tagName, attr );
            }

            if ( textAfter )
            {
                this.pushText( textAfter );
            }
        }

        if ( ! matched )
            return input;

        return this.resetPlainText();
    };

    public pushText( text: string ): void
    {
        var topTag, error;

        text = MumeXmlParser.decodeEntities( text );
        topTag = this.topTag();

        if ( !topTag || topTag.name === "xml" )
        {
            this.plainText += text;
        }
        else if ( topTag.text.length > 4096 )
        {
            error = "Probable bug: run-away MumeXmlParser tag " + topTag.name +
                ", text: " + topTag.text.substr( 0, 50 );
            this.tagStack.pop();
            throw error;
        }
        else
        {
            this.plainText += text;
            topTag.text += text;
        }
    };

    public startTag( tagName: string, attr: string )
    {
        this.tagStack.push( { name: tagName, attr: attr, text: "" } );

        if ( this.tagStack.length > 5 )
            throw "Bug: deeply nested MumeXmlParser tags: " +
                this.tagStack.join();

        return;
    };

    public endTag( tagName: string )
    {
        let matchingTagIndex: number | null = null;

        // Find the uppermost tag in the stack which matches tagName
        for ( let i = this.tagStack.length - 1; i >= 0; ++i )
        {
            if ( this.tagStack[i].name === tagName )
            {
                matchingTagIndex = i;
                break;
            }
        }

        // Perform some sanity checks
        if ( matchingTagIndex == null )
            throw "Bug: unmatched closing MumeXmlParser tag " + tagName;
        else if ( matchingTagIndex !== this.tagStack.length - 1 )
        {
            let error = "Bug: closing MumeXmlParser tag " + tagName +
                " with the following other tags open: " +
                this.tagStack.slice( matchingTagIndex + 1 ).join();

            this.tagStack = [];
            throw error;
        }

        let topTag = this.tagStack.pop();
        $(this).triggerHandler( MumeXmlParser.SIG_TAG_END, [ topTag, ] );
    };
}

global.MumeMap       = MumeMap;
global.MumeXmlParser = MumeXmlParser;

})( this );
