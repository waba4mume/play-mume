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

/* Provides a single Deferred that waits for all Deferreds in elems to be
 * completed. Each elem is expected to have a matching context from the
 * contexts Array, which is provided as a first arg to the actions. The
 * doneAction and failAction are called depending on the result of the
 * deferreds. Returns result or a new Deferred if not provided. Avoid providing
 * a long list of immediate (already resolved/rejected) elems as that
 * can lead to an infinite recursion error.
 */
function forEachDeferred( elems: Array<JQueryPromise<any>>, contexts: Array<any>,
    thisArg: any, doneAction: Function, failAction: Function,
    result?: JQueryDeferred<any> ): JQueryDeferred<any>
{
    if ( typeof result !== "object" )
        result = jQuery.Deferred();

    if ( doneAction == null )
        doneAction = function() {};

    if ( failAction == null )
        failAction = function() {};

    let currentElem = elems.pop();
    if ( currentElem == undefined )
        return result.resolve();

    let currentContext = contexts.pop();

    currentElem
        .done( forEachDeferredActionWrapper.bind( thisArg, doneAction, currentContext ) )
        .fail( forEachDeferredActionWrapper.bind( thisArg, failAction, currentContext ) )
        .always( forEachDeferred.bind( undefined, elems, contexts, thisArg,
            doneAction, failAction, result ) );

    return result;
};

/* Private helper. Calls action with this and prepended context arg as per spec
 * above.
 */
function forEachDeferredActionWrapper( this: any, action: Function, currentContext: any )
{
    var args = [].slice.call( arguments, 2 );
    args.unshift( currentContext );
    action.apply( this, args );
};


/* Like map.keys(), but as an Array and IE-compatible.
 */
function mapKeys<T, U>( map: Map<T, U> )
{
    let keys: Array<T> = [];
    map.forEach( function( value, key ) { keys.push( key ); } );
    return keys;
};

/* Poor man's iconv. We know we don't need to handle anything outside of
 * latin1, and the lightest JavaScript iconv lib weights 300kB.
 */
function translitUnicodeToAscii( unicode: string ): string
{
    let ascii = "";
    for ( let i = 0; i < unicode.length; ++i )
    {
        let ch: string = unicode[i];
        let tred: string = translitUnicodeToAsciiTable[ch];
        if ( tred != undefined )
            ascii += tred;
        else
            ascii += unicode[i];
        /* String append is hopefully optimized. Otherwise, String.replace(...,
         * func) may be faster. Either way, I'm not sure it matters. */
    }

    return ascii;
};

const translitUnicodeToAsciiTable: { [key: string]: string } = {
                '\xA1': '!',    '\xA2': 'c',  '\xA3': 'L',  '\xA4': 'x',   '\xA5': 'Y',   '\xA6': '|',   '\xA7': 'P',
   '\xA8': '"', '\xA9': '(C) ', '\xAA': 'a',  '\xAB': '<<', '\xAC': '-',   '\xAD': ' ',   '\xAE': '(R)', '\xAF': '-',
   '\xB0': '0', '\xB1': '+/-',  '\xB2': '2',  '\xB3': '3',  '\xB4': "'",   '\xB5': 'u',   '\xB6': 'P',   '\xB7': '.',
   '\xB8': ',', '\xB9': '1',    '\xBA': '0',  '\xBB': '>>', '\xBC': '1/4', '\xBD': '1/2', '\xBE': '3/4', '\xBF': '?',
   '\xC0': 'A', '\xC1': 'A',    '\xC2': 'A',  '\xC3': 'A',  '\xC4': 'A',   '\xC5': 'A',   '\xC6': 'AE',  '\xC7': 'C',
   '\xC8': 'E', '\xC9': 'E',    '\xCA': 'Z',  '\xCB': 'E',  '\xCC': 'I',   '\xCD': 'I',   '\xCE': 'I',   '\xCF': 'I',
   '\xD0': 'D', '\xD1': 'N',    '\xD2': 'O',  '\xD3': 'O',  '\xD4': 'O',   '\xD5': 'O',   '\xD6': 'O',   '\xD7': 'x',
   '\xD8': 'O', '\xD9': 'U',    '\xDA': 'U',  '\xDB': 'U',  '\xDC': 'U',   '\xDD': 'Y',   '\xDE': 'TH',  '\xDF': 'ss',
   '\xE0': 'a', '\xE1': 'a',    '\xE2': 'a',  '\xE3': 'a',  '\xE4': 'a',   '\xE5': 'a',   '\xE6': 'ae',  '\xE7': 'c',
   '\xE8': 'e', '\xE9': 'z',    '\xEA': 'z',  '\xEB': 'e',  '\xEC': 'i',   '\xED': 'i',   '\xEE': 'i',   '\xEF': 'i',
   '\xF0': 'd', '\xF1': 'n',    '\xF2': 'o',  '\xF3': 'o',  '\xF4': 'o',   '\xF5': 'o',   '\xF6': 'o',   '\xF7': '/',
   '\xF8': 'o', '\xF9': 'u',    '\xFA': 'u',  '\xFB': 'u',  '\xFC': 'u',   '\xFD': 'y',   '\xFE': 'th',  '\xFF': 'y',
};


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

    /* Make sure none of this data contains colour (or other) escapes,
     * because we indexed on the plain text. Same thing for linebreaks. Also remove
     * any trailing whitespace, because MMapper seems to do so.
     */
    public static sanitizeString( text: string )
    {
        return text
            .replace( MumeMapIndex.ANY_ANSI_ESCAPE, '' )
            .replace( /\r\n/g, "\n" )
            .replace( / +$/gm, "" );
    }

    /* Returns a hash of the name+desc that identifies the chunk of the name+desc
     * index we want from the server. This algorithm must be identical to what
     * MMapper uses for this version of the webmap format.
     */
    public static hashNameDesc( name: string, desc: string )
    {
        var namedesc, blob, i, hash;

        name = MumeMapIndex.sanitizeString( name );
        desc = MumeMapIndex.sanitizeString( desc );
        namedesc = name + desc;

        // MMapper2 provides pure-ASCII strings only
        blob = translitUnicodeToAscii( namedesc );

        hash = SparkMD5.hash( blob );
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



type Room3DArray = Array<Array<Array<Room>>>;;

/* Stores stuff in a x/y/z-indexed 3D array. The coordinates must be within the
 * minX/maxX/etc bounds of the metaData.
 */
class SpatialIndex
{
    private readonly metaData: MapMetaData;
    private data: Room3DArray;

    constructor( metaData: MapMetaData )
    {
        this.metaData = metaData;

        // 3D array. Hopefully, JS' sparse arrays will make this memory-efficient.
        this.data = new Array( this.metaData.maxX - this.metaData.minX );
    }

    /* Private helper to get 0-based coordinates from whatever MM2 provided */
    private getZeroedCoordinates( x: number, y: number, z: number ): any
    {
        return {
            x: x - this.metaData.minX,
            y: y - this.metaData.minY,
            z: z - this.metaData.minZ,
        };
    }

    public set( x: number, y: number, z: number, what: any ): void
    {
        let zero;

        zero = this.getZeroedCoordinates( x, y, z );

        if ( this.data[ zero.x ] === undefined )
            this.data[ zero.x ] = new Array( this.metaData.maxY - this.metaData.minY );

        if ( this.data[ zero.x ][ zero.y ] === undefined )
            this.data[ zero.x ][ zero.y ] = [];

        this.data[ zero.x ][ zero.y ][ zero.z ] = what;
    };

    /* Public. */
    public get( x: number, y: number, z: number ): any
    {
        var zero, what;

        zero = this.getZeroedCoordinates( x, y, z );

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

class Room
{
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
    private rooms: SpatialIndex | null;

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
        this.rooms = new SpatialIndex( json );

        return true;
    };

    /* Private helper that feeds the in-memory cache. */
    private setCachedRoom( room: Room ): void
    {
        this.rooms.set( room.x, room.y, room.z, room );
    };

    /* Returns a room from the in-memory cache or null if not found. Does not
     * attempt to download the zone if it's missing from the cache.
     */
    public getRoomAtCached( x: number, y: number, z: number ): any
    {
        let room = this.rooms.get( x, y, z );

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

    private getRoomResultAtCached( x: number, y: number, z: number,
        result: JQueryDeferred<any> ): JQueryDeferred<any>
    {
        let room = this.getRoomAtCached( x, y, z );
        if ( room === null )
            return result.reject();
        else
            return result.resolve( room );
    };

    /* Private. Stores a freshly retrieved JSON zone into the in-memory cache. */
    private cacheZone( zone: string, json: any ): boolean
    {
        if ( !Array.isArray( json ) )
        {
            console.error( "Expected to find an Array for zone %s, got %O", zone, json );
            return false;
        }

        let count = 0;
        for ( let i = 0; i < json.length; ++i )
        {
            let room = json[ i ];

            let missing = new Array<string>();
            for ( let prop in new Room() )
                if ( !json.hasOwnProperty( prop ) )
                    missing.push( prop );

            if ( missing.length !== 0 )
            {
                console.error( "Missing properties %O in room #%d of zone %s", missing, i, zone );
                return false;
            }

            this.setCachedRoom( room );
            ++count;
        }

        console.log( "MumeMapData cached %d rooms for zone %s", count, zone );
        this.cachedZones.add( zone );
        return true;
    };

    /* Returns the x,y zone for that room's coords, or null if out of the map.
     */
    public getRoomZone( x: number, y: number ): string?
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
    public getRoomAt( x: number, y: number, z: number ): JQueryDeferred<any>
    {
        let result = jQuery.Deferred();

        let zone = this.getRoomZone( x, y );
        if ( zone === null || this.nonExistentZones.has( zone ) )
            return result.reject();

        if ( this.cachedZones.has( zone ) )
            return this.getRoomResultAtCached( x, y, z, result );

        this.downloadAndCacheZone( zone )
            .done( () =>
            {
                this.getRoomResultAtCached( x, y, z, result );
            } );

        return result;
    };

    /* Fetches rooms at an Array of x/y/z coords from the cache or the server.
     * Returns arrays of rooms through a jQuery Deferred. The rooms are returned as
     * soon as they are available as notify()cations and as a summary in the final
     * resolve(). Rooms that do not exist are not part of the results.
     */
    public getRoomsAt( coordinates: any ): JQueryDeferred<Array<any>>
    {
        let result = jQuery.Deferred();
        let downloadDeferreds = [];
        let zonesNotInCache = new Map<string, any>(); // zone => [ coords... ]
        let roomsInCache: Array<any> = [];
        let roomsDownloaded: Array<any> = [];

        // Sort coordinates into rooms in cache and rooms needing a download
        for ( let i = 0; i < coordinates.length; ++i )
        {
            let coords = coordinates[i];
            let zone = this.getRoomZone( coords.x, coords.y );
            if ( zone === null )
                continue;

            if ( this.nonExistentZones.has( zone ) )
            {
                // Do nothing if the zone doesn't exist on the server
            }
            else if ( !this.cachedZones.has( zone ) )
            {
                if ( zonesNotInCache.has( zone ) )
                    zonesNotInCache.get( zone ).push( coords );
                else
                {
                    zonesNotInCache.set( zone, [ coords ] );

                    console.log( "Downloading map zone %s for room %d,%d", zone, coords.x, coords.y );
                    const url = MAP_DATA_PATH + "zone/" + zone + ".json";
                    downloadDeferreds.push( jQuery.getJSON( url ) );
                }
            }
            else
            {
                const room = this.getRoomAtCached( coords.x, coords.y, coords.z );
                if ( room != null )
                    roomsInCache.push( room );
            }
        }

        // Return cached rooms immediatly through a notify
        result.notify( roomsInCache );

        // Download the rest
        let downloadResult = forEachDeferred( downloadDeferreds, mapKeys( zonesNotInCache ), this,
            // doneAction
            function( zone2: string, json: any )
            {
                console.log( "Zone %s downloaded", zone2 );
                this.cacheZone( zone2, json );

                // Send the batch of freshly downloaded rooms
                let coordinates2 = zonesNotInCache.get( zone2 );
                let rooms2 = [];
                for ( let j = 0; j < coordinates2.length; ++j )
                {
                    let coords2 = coordinates2[j];
                    let room2 = this.getRoomAtCached( coords2.x, coords2.y, coords2.z );
                    if ( room2 != null )
                    {
                        rooms2.push( room2 );
                        roomsDownloaded.push( room2 );
                    }
                }
                result.notify( rooms2 );
            },
            // failAction
            function( zone2: string, jqXHR: JQueryXHR, textStatus: string, error: string )
            {
                if ( jqXHR.status === 404 )
                {
                    this.nonExistentZones.add( zone2 );
                    console.log( "Map zone %s does not exist: %s, %O", zone2, textStatus, error );
                    // Not an error: zones without data simply don't get output
                }
                else
                    console.error( "Downloading map zone %s failed: %s, %O", zone2, textStatus, error );
            } );

        // Return a summary
        downloadResult.always( function() { result.resolve( roomsInCache.concat( roomsDownloaded ) ); } );

        return result;
    }
}





/* Renders mapData into a DOM placeholder identified by containerElementName.
 */
class MumeMapDisplay
{
    private mapData: MumeMapData;
    private containerElementName: string;
    private roomDisplays: SpatialIndex;

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
    private static buildRoomDisplay( room: any )
    {
        let display = new PIXI.Container();

        // load a PNG as background (sector type)
        let imgPath = MumeMapDisplay.getSectorAssetPath( room.sector );
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
            if ( typeof room[ border[0] ] !== "number" )
            {
                borders.moveTo( border[1], border[2] );
                borders.lineTo( border[3], border[4] );
            }
        } );
        display.addChild( borders );

        // Position the room display in its layer
        display.position = new PIXI.Point( room.x * ROOM_PIXELS, room.y * ROOM_PIXELS );
        /*console.log( "MumeMapDisplay added room %s (%d,%d) in PIXI at %O",
            room.name, room.x, room.y, display.getGlobalPosition() );*/

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
    public repositionHere( x: number, y: number ): JQueryPromise<any>
    {
        this.herePointer.position = new PIXI.Point( x * ROOM_PIXELS, y * ROOM_PIXELS );
        this.herePointer.visible = true;

        // Scroll to make the herePointer visible
        var pointerGlobalPos = this.herePointer.toGlobal( new PIXI.Point( 0, 0 ) );
        this.stage.x += - pointerGlobalPos.x + 400;
        this.stage.y += - pointerGlobalPos.y + 300;
        console.log( "Recentering view to (r) %d,%d, (px) %d,%d", x, y, this.stage.x, this.stage.y );

        let coordinates = [];
        for ( let i = x - 20; i < x + 20; ++i )
            for ( let j = y - 20; j < y + 20; ++j )
                if ( this.roomDisplays.get( i, j, -1 ) == null )
                    coordinates.push( { x: i, y: j, z: -1 } );

        let result = this.mapData.getRoomsAt( coordinates )
            .progress( ( rooms: Array<any> ) =>
            {
                var k, display, room;
                for ( k = 0; k < rooms.length; ++k )
                {
                    room = rooms[k];
                    display = MumeMapDisplay.buildRoomDisplay( room );
                    if ( this.roomDisplays.get( room.x, room.y, room.z ) == null )
                    {
                        this.roomDisplays.set( room.x, room.y, room.z, display );
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
