namespace Mapper
{

const ROOM_PIXELS = 48;
const MAP_DATA_PATH = "mapdata/v1/";
enum Dir { // Must match MM2's defs.
    NORTH = 0,
    SOUTH = 1,
    EAST = 2,
    WEST = 3,
    LAST_GROUND_DIR = WEST,
    UP = 4,
    DOWN = 5,
    NONE = 6,
    UNKNOWN = 7,
}

/* Like JQuery.when(), but the master Promise is resolved only when all
 * promises are resolved or rejected, not at the first rejection. */
function whenAll<T>( deferreds: Array<JQueryPromise<T>> )
{
    let master: JQueryDeferred<T> = jQuery.Deferred();

    if ( deferreds.length === 0 )
        return master.resolve();

    let pending = new Set<JQueryPromise<T>>();
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
}

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
export class MumeMap
{
    public mapData: MumeMapData | null = null;
    public mapIndex: MumeMapIndex | null = null;
    public display: MumeMapDisplay;
    public pathMachine: MumePathMachine;
    public processTag: ( event: any, tag: MumeXmlParserTag ) => void;
    public static debugInstance: MumeMap;

    constructor( mapData: MumeMapData, display: MumeMapDisplay )
    {
        this.mapData = mapData;
        this.display = display;
        this.mapIndex = new MumeMapIndex();
        this.pathMachine = new MumePathMachine( this.mapData, this.mapIndex );
        this.processTag =
            ( event: any, tag: MumeXmlParserTag ) => this.pathMachine.processTag( event, tag );

        MumeMap.debugInstance = this;
    }

    public static load( containerElementName: string ): JQueryPromise<MumeMap>
    {
        let result = jQuery.Deferred();

        MumeMapData.load().done( ( mapData: MumeMapData ) =>
        {
            MumeMapDisplay.load( containerElementName, mapData ).done( ( display: MumeMapDisplay ) => {
                let map = new MumeMap( mapData, display );

                $( map.pathMachine ).on(
                    MumePathMachine.SIG_MOVEMENT,
                    ( event, where ) => map.onMovement( event, where ) );

                result.resolve( map );
            } );
        } );

        return result;
    }

    public onMovement( event: any, where: RoomCoords ): void
    {
        this.display.repositionTo( where );
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
    public here: RoomCoords | null;

    constructor( mapData: MumeMapData, mapIndex: MumeMapIndex )
    {
        this.mapData = mapData;
        this.mapIndex = mapIndex;
        this.roomName = null;
        this.here = null;
    }

    /* This receives an event from MumeXmlParser when it encounters a closing tag.
     * */
    public processTag( event: any, tag: MumeXmlParserTag ): void
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
            .done( ( coordinates: Array<RoomCoords> ) =>
            {
                this.here = coordinates[0];
                $(this).triggerHandler( MumePathMachine.SIG_MOVEMENT, [ coordinates[0] ] );
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

    private cache: Map<string, Array<RoomCoords>>;
    private cachedChunks: Set<string>;

    constructor()
    {
        this.cache = new Map<string, Array<RoomCoords>>();
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
        let invalid = 0;

        oldSize = this.cache.size;

        for ( hash in json )
        {
            if ( json.hasOwnProperty( hash ) )
            {
                let rawCoordsArray: Array<Array<number>> = json[ hash ];
                if ( !Array.isArray( rawCoordsArray ) )
                {
                    ++invalid;
                    continue;
                }

                let coordsArray: Array<RoomCoords> | null = [];
                for ( let rawCoords of rawCoordsArray )
                {
                    if ( !Array.isArray( rawCoords ) || rawCoords.length !== 3 )
                    {
                        coordsArray = null;
                        break;
                    }
                    else
                        coordsArray.push( new RoomCoords( rawCoords[0], rawCoords[1], rawCoords[2] ) );
                }

                if ( coordsArray === null )
                    ++invalid;
                else
                    this.cache.set( hash, coordsArray );
            }
        }

        sizeIncrease = this.cache.size - oldSize;
        jsonSize = Object.keys( json ).length;

        console.log( "MumeMapIndex: cached %d new entries (%d total), ignored %d invalid",
            sizeIncrease, this.cache.size, jsonSize, invalid );

        if ( sizeIncrease != jsonSize )
            console.error( "MumeMapIndex: stray index entries in %O?", json );
    }

    // Private helper for findPosByNameDesc().
    private findPosByNameDescCached( name: string, desc: string,
        result: JQueryDeferred<Array<RoomCoords>>, hash: string ): JQueryDeferred<Array<RoomCoords>>
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
    public findPosByNameDesc( name: string, desc: string ): JQueryDeferred<Array<RoomCoords>>
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
    private preventDuckTyping: never;

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
export class RoomCoords
{
    private preventDuckTyping: never;

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
    }

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
    }
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

    public static assertValid( json: MapMetaData ): void
    {
        let missing = new Array<string>();
        for ( let prop in new MapMetaData() )
            if ( !json.hasOwnProperty( prop ) )
                missing.push( prop );

        if ( missing.length !== 0 )
            throw "Missing properties in loaded metadata: " + missing.join( ", " );
    }
}

interface RoomId extends Number {
    _roomIdBrand: never; // Prevent implicit conversion with Number
}

// This is what we load from the server, inside RoomData.
class RoomExit
{
    name: string = "";
    dflags: number = 0;
    flags: number = 0;
    in: Array<RoomId> = [];
    out: Array<RoomId> = [];
}

class RoomData
{
    name: string = "";
    desc: string = "";
    id: RoomId = <any>0; // RoomIds are not meant to be created, yet we need a placeholder
    x: number = 0;
    y: number = 0;
    z: number = 0;
    exits: Array<RoomExit> = [];
    sector: number = 0;
    loadflags: number = 0;
    mobflags: number = 0;
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
    public metaData: MapMetaData;
    /* Private in-memory room cache. */
    private rooms: SpatialIndex<Room>;

    // Arda is split into JSON files that wide.
    private static readonly ZONE_SIZE = 20;

    /* Initiates loading the external JSON map data.
     * Returns a JQuery Deferred that can be used to execute further code once done.
     */
    public static load(): JQueryPromise<MumeMapData>
    {
        let result = jQuery.Deferred();

        jQuery.getJSON( MAP_DATA_PATH + "arda.json" )
            .done( ( json: MapMetaData ) =>
            {
                try {
                    result.resolve( new MumeMapData( json ) );
                    console.log( "Map metadata loaded" );
                }
                catch ( e )
                {
                    console.error( "Loading metadata failed: %O", e );
                    result.reject();
                }
            } )
            .fail( function( jqxhr, textStatus, error )
            {
                console.error( "Loading metadata failed: %s, %O", textStatus, error );
                result.reject();
            } );

        return result;
    }

    constructor( json: MapMetaData )
    {
        MapMetaData.assertValid( json );
        this.metaData = <MapMetaData>json;
        this.rooms = new SpatialIndex<Room>( json );
    }

    /* Private helper that feeds the in-memory cache. */
    private setCachedRoom( room: Room ): void
    {
        this.rooms.set( room.coords(), room );
    }

    /* Returns a room from the in-memory cache or null if not found. Does not
     * attempt to download the zone if it's missing from the cache.
     */
    public getRoomAtCached( c: RoomCoords ): Room | null
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
    }

    private getRoomResultAtCached( c: RoomCoords,
        result: JQueryDeferred<Room> ): JQueryDeferred<Room>
    {
        let room = this.getRoomAtCached( c );
        if ( room === null )
            return result.reject();
        else
            return result.resolve( room );
    }

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
    }

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
    }

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
    }

    /* Fetches a room from the cache or the server. Returns a jQuery Deferred. */
    public getRoomAt( c: RoomCoords ): JQueryDeferred<Room>
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
    }

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
        let roomsNotInCachePerZone = new Map<string, Set<RoomCoords>>();
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
                let roomsNotInCache = roomsNotInCachePerZone.get( zone );
                if ( roomsNotInCache )
                    roomsNotInCache.add( coords );
                else
                {
                    roomsNotInCache = new Set<RoomCoords>();
                    roomsNotInCache.add( coords );
                    roomsNotInCachePerZone.set( zone, roomsNotInCache );

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
                    let neededCoords = roomsNotInCachePerZone.get( download.zone );
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



// Algorithms that build PIXI display elements.
namespace Mm2Gfx
{
    enum Sector
    {
        UNDEFINED      =  0,
        INSIDE         =  1,
        CITY           =  2,
        FIELD          =  3,
        FOREST         =  4,
        HILLS          =  5,
        MOUNTAIN       =  6,
        WATER_SHALLOW  =  7,
        WATER          =  8,
        WATER_NOBOAT   =  9,
        UNDERWATER     = 10,
        ROAD           = 11,
        BRUSH          = 12,
        TUNNEL         = 13,
        CAVERN         = 14,
        DEATHTRAP      = 15,
        COUNT          = 16,
    }

    enum ExitFlags
    {
        ROAD = ( 1 << 2 ),
    }

    type RoadKind = "road" | "trail";
    type ExtraKind = "mob" | "load";

    const MOB_FLAGS = 15;
    const LOAD_FLAGS = 16;

    function getSectorAssetPath( sector: number ): string
    {
        return "resources/pixmaps/terrain" + sector + ".png";
    }

    function getRoadAssetPath( dirsf: number, kind: RoadKind ): string
    {
        return `resources/pixmaps/${kind}${dirsf}.png`;
    }

    function getExtraAssetPath( extra: number, kind: ExtraKind ): string
    {
        return `resources/pixmaps/${kind}${extra}.png`;
    }

    export function getAllAssetPaths(): Array<String>
    {
        let paths: Array<String> = [];

        for ( let i = 0; i < Sector.COUNT; ++i )
            paths.push( getSectorAssetPath( i ) );

        for ( let i = 0; i < ( 1 << ( Dir.LAST_GROUND_DIR + 1 ) ); ++i )
        {
            paths.push( getRoadAssetPath( i, "road" ) );
            paths.push( getRoadAssetPath( i, "trail" ) );
        }

        for ( let i = 0; i < MOB_FLAGS; ++i )
            paths.push( getExtraAssetPath( i, "mob" ) );
        for ( let i = 0; i < LOAD_FLAGS; ++i )
            paths.push( getExtraAssetPath( i, "load" ) );

        return paths;
    }

    // Road and trail assets are numbered 0..15 based on bit operations
    // describing which exits are roads/trails.
    function roadDirsFlags( room: Room ) : number
    {
        let dirsf: number = 0;

        for ( let dir = 0; dir <= Dir.LAST_GROUND_DIR; ++dir )
            if ( room.data.exits[ dir ].flags & ExitFlags.ROAD )
                dirsf |= ( 1 << dir );

        return dirsf;
    }

    function buildRoomSector( room: Room ) : PIXI.DisplayObject
    {
        let display: PIXI.DisplayObject;
        let sector: PIXI.Sprite;
        let dirsf = roadDirsFlags( room );
        if ( room.data.sector === Sector.ROAD )
        {
            let imgPath = getRoadAssetPath( dirsf, "road" );
            display = sector = new PIXI.Sprite( PIXI.loader.resources[ imgPath ].texture );
        }
        else
        {
            let imgPath = getSectorAssetPath( room.data.sector );
            sector = new PIXI.Sprite( PIXI.loader.resources[ imgPath ].texture );

            if ( dirsf !== 0 ) // Trail (road exits but not Sectors.ROAD)
            {
                let trailPath = getRoadAssetPath( dirsf, "trail" );
                let trail = new PIXI.Sprite( PIXI.loader.resources[ trailPath ].texture );

                display = new PIXI.Container();
                sector.addChild( sector, trail );
            }
            else
                display = sector;
        }

        sector.height = sector.width = ROOM_PIXELS; // Just in case we got a wrong PNG here

        return sector;
    }

    function buildRoomBorders( room: Room ) : PIXI.Graphics
    {
        let borders = new PIXI.Graphics();
        borders.lineStyle( 2, 0x000000, 1 );

        let borderSpec = [
            { dir: Dir.NORTH, x0: 0,           y0: 0,           x1: ROOM_PIXELS, y1: 0           },
            { dir: Dir.EAST,  x0: ROOM_PIXELS, y0: 0,           x1: ROOM_PIXELS, y1: ROOM_PIXELS },
            { dir: Dir.SOUTH, x0: ROOM_PIXELS, y0: ROOM_PIXELS, x1: 0,           y1: ROOM_PIXELS },
            { dir: Dir.WEST,  x0: 0,           y0: ROOM_PIXELS, x1: 0,           y1: 0           },
        ];

        for ( let spec of borderSpec )
        {
            if ( room.data.exits[ spec.dir ].out.length === 0 )
            {
                borders.moveTo( spec.x0, spec.y0 );
                borders.lineTo( spec.x1, spec.y1 );
            }
        };

        return borders;
    }

    function buildRoomExtra( room: Room, kind: ExtraKind ) : PIXI.DisplayObject | null
    {
        const flagsCount = (kind === "load" ? LOAD_FLAGS : MOB_FLAGS );
        const flags = (kind === "load" ? room.data.loadflags : room.data.mobflags );

        let paths: Array<string> = [];
        for ( let i = 0; i < flagsCount; ++i )
            if ( flags & ( 1 << i ) )
                paths.push( getExtraAssetPath( i, kind ) );

        if ( paths.length === 0 )
            return null;

        // Do not allocate a container for the common case of a single load flag
        if ( paths.length === 1 )
            return new PIXI.Sprite( PIXI.loader.resources[ paths[0] ].texture );

        let display = new PIXI.Container();
        for ( let path of paths )
            display.addChild( new PIXI.Sprite( PIXI.loader.resources[ path ].texture ) );
        return display;
    }

    function maybeAddChild( display: PIXI.Container, child: PIXI.DisplayObject | null ): void
    {
        if ( child != null )
            display.addChild( child );
    }

    /* Returns the graphical structure for a single room for rendering (base
     * texture, walls, flags etc). */
    export function buildRoomDisplay( room: Room ): PIXI.Container
    {
        let display = new PIXI.Container();

        display.addChild( buildRoomSector( room ) );
        display.addChild( buildRoomBorders( room ) );
        maybeAddChild( display, buildRoomExtra( room, "mob" ) );
        maybeAddChild( display, buildRoomExtra( room, "load" ) );

        // Position the room display in its layer
        display.position = new PIXI.Point( room.data.x * ROOM_PIXELS, room.data.y * ROOM_PIXELS );
        /*console.log( "MumeMapDisplay added room %s (%d,%d) in PIXI at local:%O, global:%O",
            room.data.name, room.data.x, room.data.y, display.position, display.getGlobalPosition() );*/

        display.cacheAsBitmap = true;
        return display;
    }

    /* Returns the graphical structure for the yellow square that shows the current
     * position to the player. */
    export function buildHerePointer(): PIXI.DisplayObject
    {
        const size = ROOM_PIXELS * 1.4;
        const offset = ( size - ROOM_PIXELS ) / 2;

        let square = new PIXI.Graphics();
        square.lineStyle( 2, 0xFFFF00, 1 );
        square.drawRect( -offset, -offset, size, size );

        square.beginFill( 0x000000, 0.1 );
        square.drawRect( -offset, -offset, size, size );
        square.endFill();

        return square;
    }
}

/* Renders mapData into a DOM placeholder identified by containerElementName.
 */
class MumeMapDisplay
{
    private mapData: MumeMapData;
    private here: RoomCoords | undefined;

    // PIXI elements
    private roomDisplays: SpatialIndex<PIXI.Container>;
    private herePointer: PIXI.DisplayObject;
    private layers: Array<PIXI.Container> = [];
    private pixi: PIXI.Application;

    // Use load() instead if the assets might not have been loaded yet.
    constructor( containerElementName: string, mapData: MumeMapData )
    {
        this.mapData = mapData;
        this.roomDisplays = new SpatialIndex( this.mapData.metaData );

        this.installMap( containerElementName );
        this.buildMapDisplay();

    }

    // Async factory function. Returns a Display when the prerequisites are loaded.
    public static load( containerElementName: string, mapData: MumeMapData ): JQueryPromise<MumeMapDisplay>
    {
        let result = jQuery.Deferred();

        // Start loading assets
        PIXI.loader.add( Mm2Gfx.getAllAssetPaths() );
        PIXI.loader.load( () => {
            let display = new MumeMapDisplay( containerElementName, mapData );
            result.resolve( display );
        } );

        return result;
    }

    /* Installs the viewport into the DOM. */
    public installMap( containerElementName: string ): void
    {
        this.pixi = new PIXI.Application( { autoStart: false, } );
        this.pixi.renderer.autoResize = true;
        this.pixi.renderer.backgroundColor = 0x6e6e6e;

        let stub = document.getElementById( containerElementName );
        if ( stub == null || stub.parentElement == null )
            $( "body" ).append( this.pixi.renderer.view );
        else
            stub.parentElement.replaceChild( this.pixi.renderer.view, stub );
    }

    public fitParent(): boolean
    {
        if ( this.pixi.renderer.view.parentElement == null )
        {
            console.warn( "PIXI canvas has no parent element?" );
            return false;
        }

        let canvasParent = $( this.pixi.renderer.view.parentElement );

        if ( canvasParent.is( ":visible" ) && canvasParent.width() && canvasParent.height() )
        {
            let width  = <number>canvasParent.width();
            let height = <number>canvasParent.height();

            // Non-integers may cause the other dimension to unexpectedly
            // increase. 535.983,520 => 535.983,520.95, then rounded up to the
            // nearest integer, causing scrollbars.
            // Furthermore, in FF 52 ESR (at least), the actual height of the
            // canvas seems to be a few px more than reported by the Dev Tools,
            // causing scrollbars again. Same issue in Chromium 62 for the map window.
            width = Math.floor( width );
            height = Math.floor( height ) - 4;

            this.pixi.renderer.resize( width, height );
            this.fullRefresh();
        }
        else
        {
            this.pixi.renderer.resize( 0, 0 );
        }

        return true;
    }

    public isVisible(): boolean
    {
        let visible = this.pixi.screen.width > 0 && this.pixi.screen.height > 0;
        return visible;
    }

    /* Called when all assets are available. Constructs the graphical structure
     * (layers etc) used for rendering and throw all that at the rendering layer
     * (Pixi lib). */
    public buildMapDisplay(): void
    {
        // Everything belongs to the map, so we can move it around to emulate
        // moving the viewport
        let map = new PIXI.Container();

        // Rooms live on layers, there is one layer per z coord
        for ( let i = 0; i < this.mapData.metaData.maxZ - this.mapData.metaData.minZ; ++i )
        {
            let layer = new PIXI.Container();
            this.layers.push( layer );
            map.addChild( layer );
        }

        // Add the current room yellow square
        this.herePointer = Mm2Gfx.buildHerePointer();
        this.herePointer.visible = false;
        map.addChild( this.herePointer );

        // And set the stage
        this.pixi.stage.addChild( map );
        this.pixi.render();

        return;
    }

    private static dumpContainer( indent: number, name: string, what: PIXI.DisplayObject ): void
    {
        let indentStr = "";
        while ( indent-- )
            indentStr += "  ";

        console.log( "%s%s: @%d,%d x=b=%d y=c=%d tx=%d ty=%d",
            indentStr, name,
            what.x, what.y,
            what.worldTransform.b, what.worldTransform.c,
            what.worldTransform.tx, what.worldTransform.ty );
    }

    public dumpAllCoords(): void
    {
        MumeMapDisplay.dumpContainer( 0, "stage", this.pixi.stage );

        let mapDO = this.pixi.stage.children[0];

        if ( !( mapDO instanceof PIXI.Container ) )
            return;
        let map: PIXI.Container = mapDO;

        MumeMapDisplay.dumpContainer( 1, "map", map );
        for ( let i = 0; i < map.children.length; ++i )
        {
            let name = ( i == map.children.length - 1 ) ? "herePointer" : "layer";
            MumeMapDisplay.dumpContainer( 2, name, map.children[i] );
        }
    }

    private roomCoordsToPoint( where: RoomCoords): PIXI.Point
    {
        return new PIXI.Point( where.x * ROOM_PIXELS, where.y * ROOM_PIXELS );
    }

    private zeroZ( z: number ): number
    {
        return z - this.mapData.metaData.minZ;
    }

    private layerForCoords( coords: RoomCoords ): PIXI.Container
    {
        let zeroedZ = this.zeroZ( coords.z );
        return this.layers[zeroedZ];
    }

    private roomCoordsNear( where: RoomCoords ): Array<RoomCoords>
    {
        let coordinates: Array<RoomCoords> = [];
        for ( let i = where.x - 20; i < where.x + 20; ++i )
        {
            for ( let j = where.y - 20; j < where.y + 20; ++j )
            {
                for ( let k = this.mapData.metaData.minZ; k <= this.mapData.metaData.maxZ; ++k )
                {
                    let c = new RoomCoords( i, j, k );
                    if ( this.roomDisplays.get( c ) == null )
                        coordinates.push( c );
                    // Yes, this tight loop is probably horrible for memory & CPU
                }
            }
        }

        return coordinates;
    }

    /* We want a perspective effect between the layers to emulate 3D rendering.
     * For that purpose, we need to set the pivot of each layer to the current
     * position so that the upper/lower layers are scaled up/down like
     * perspective would.
     *
     * However, PIXI's pivot is actually the anchor point for position, too, so
     * under the hood we shift the layers around. It doesn't affect the rest of
     * the code because it is hidden inside the map/stage abstraction.
     */
    private repositionLayers( where: RoomCoords ): void
    {
        let z = this.zeroZ( where.z );
        for ( let i = 0; i < this.layers.length; ++i )
        {
            let layer = this.layers[i];

            let localPx = this.roomCoordsToPoint( where );
            localPx.x += ROOM_PIXELS / 2;
            localPx.y += ROOM_PIXELS / 2;

            layer.visible = false;
            layer.scale.set( 1, 1 ); // pivot is affected by scale!
            layer.pivot = layer.position = localPx;
            layer.alpha = 1;
            layer.filters = [];

            if ( i === z - 1 ) // Shrink and darken the lower layer
            {
                layer.visible = true;
                layer.scale.set( 0.8, 0.8 );
                if ( this.pixi.renderer.type === PIXI.RENDERER_TYPE.WEBGL )
                {
                    let filter = new PIXI.filters.ColorMatrixFilter();
                    filter.brightness( 0.4, false );
                    layer.filters = [ filter ];
                }
                else
                {
                    layer.alpha = 0.6;
                }
            }
            else if ( i === z )
            {
                layer.visible = true;
            }
            else if ( i === z + 1 ) // Enlarge and brighten the upper layer
            {
                layer.visible = true;
                layer.scale.set( 1.2, 1.2 );
                layer.alpha = 0.1;
            }

            /*console.log("layer[%d].position == %d,%d%s", i, layer.position.x, layer.position.y,
                ( i === z ? " (active)" : "" ) );*/
        }
    }

    /* Repositions the HerePointer (yellow square), centers the view, and fetches
     * nearby rooms for Pixi. Refreshes the view once done.
     */
    public repositionTo( where: RoomCoords ): void
    {
        this.here = where;

        if ( !this.isVisible() )
            return;

        console.log( "Recentering view to (r) %O", where );

        this.herePointer.position = new PIXI.Point( where.x * ROOM_PIXELS, where.y * ROOM_PIXELS );
        this.herePointer.visible = true;

        this.repositionLayers( where );

        // Scroll to make the herePointer visible
        const hpPos = this.herePointer.position;
        this.pixi.stage.x = - hpPos.x + this.pixi.screen.width / 2;
        this.pixi.stage.y = - hpPos.y + this.pixi.screen.height / 2;
        // PIXI.CanvasRenderer doesn't seem to update the stage's transform
        // correctly (not all all, lagging, plain wrong, pick one). This forces
        // a working update.
        this.pixi.stage.toGlobal( new PIXI.Point( 0, 0 ) );

        const coordinates: Array<RoomCoords> = this.roomCoordsNear( where );
        let background = this.mapData.getRoomsAt( coordinates )
            .progress( ( rooms: Array<Room> ) =>
            {
                console.log( "repositionHere progress, %d rooms", rooms.length );
                for ( let k = 0; k < rooms.length; ++k )
                {
                    let room = rooms[k];
                    let c = room.coords();
                    let display = Mm2Gfx.buildRoomDisplay( room );
                    if ( this.roomDisplays.get( c ) == null )
                    {
                        this.roomDisplays.set( c, display );
                        this.layerForCoords( c ).addChild( display );
                    }
                }
            } );

        background.done( () => this.pixi.render() );
    }

    /* Update all graphical elements to match the current position, going as
     * far as fetching rooms if needed. */
    public fullRefresh()
    {
        if ( this.here != null )
            this.repositionTo( this.here );
        else
            console.warn( "ignoring MumeMapDisplay.fullRefresh(): no position known" );
    }
}



interface MumeXmlParserTag
{
    name: string;
    attr: string;
    text: string;
}

enum MumeXmlMode
{
    // Not requested. We won't interpret <xml> tags, as players could send us fakes.
    Off,
    // We will request XML mode as soon as we're done with the login prompt.
    AsSoonAsPossible,
    // We requested XML mode and will enable it as soon as we get a <xml>
    Desirable,
    // We are in XML mode, interpreting <tags>
    On,
}

class ScoutingState
{
    public active: boolean = false;
    // We stop scouting automatically after a bit if somehow we missed the STOP message
    private scoutingBytes: number = 0;

    private static readonly START = /^You quietly scout (north|east|south|west|up|down)wards\.\.\.\s*$/m;
    private static readonly STOP = /^You stop scouting\.\s*$/m;

    public pushText( text: string ): void
    {
        let startMatch = text.match( ScoutingState.START );
        if ( startMatch )
        {
            let startIndex = startMatch.index;
            if ( startIndex === undefined ) // Shouldn't happen, but it does keep TS happy
                startIndex = text.indexOf( "You quietly scout" );
            this.scoutingBytes = text.length - ( startIndex + startMatch[0].length );

            this.active = true;
            console.log( "Starting to scout, ignoring new rooms." );
        }
        else if ( this.active )
        {
            this.scoutingBytes += text.length;

            if ( text.match( ScoutingState.STOP ) )
            {
                this.active = false;
                console.log( "Done scouting." );
            }
            else if ( this.scoutingBytes > 1024 )
            {
                this.active = false;
                console.warn( "Force-disabling scout mode after a while" );
            }
        }
    }

    public endTag( tag: MumeXmlParserTag ): void
    {
        if ( this.active && tag.name === "movement" )
        {
            // This typically happens when scouting a oneway
            this.active = false;
            console.log( "Aborting scout because of movement" );
        }
    }
};

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
export class MumeXmlParser
{
    // instanceof doesn't work cross-window
    private readonly isMumeXmlParser = true;

    private tagStack: Array<MumeXmlParserTag>;
    private plainText: string;
    private mode: MumeXmlMode;
    private xmlDesirableBytes: number = 0;
    private decaf: DecafMUD;
    private scouting: ScoutingState

    constructor( decaf: DecafMUD )
    {
        this.decaf = decaf;
        this.clear();
    }

    public static readonly SIG_TAG_END = "tagend";

    public clear(): void
    {
        this.tagStack = [];
        this.plainText = "";
        this.mode = MumeXmlMode.Off;
        this.scouting = new ScoutingState();
    }

    public connected(): void
    {
        this.clear();
        this.mode = MumeXmlMode.AsSoonAsPossible;
    }

    private setXmlModeDesirable(): void
    {
        this.mode = MumeXmlMode.Desirable;
        this.xmlDesirableBytes = 0;
    }

    private static readonly ENTER_GAME_LINES = new RegExp(
        /^Reconnecting\.\s*$/.source + "|" +
        /^Never forget! Try to role-play\.\.\.\s*$/.source, 'm' );

    private detectXml( input: string ): { text: string, xml: string, }
    {
        switch ( this.mode )
        {
        case MumeXmlMode.AsSoonAsPossible:
            if ( input.match( MumeXmlParser.ENTER_GAME_LINES ) )
            {
                // Negociating XML mode at once sends a double login prompt,
                // which is unsightly as it is the first thing that players
                // see. WebSockets do not let us send the negociation string
                // before the MUD outputs anything, like MM2 does.

                // Wait until we're done with the pre-play to request XML mode +
                // gratuitous descs. Hopefully, the first screen won't be split
                // across filterInputText() calls, or we'll have to keep state.
                this.decaf.socket.write( "~$#EX2\n1G\n" );
                this.setXmlModeDesirable();
                console.log( "Negotiating MUME XML mode" );
            }

            // fall through

        case MumeXmlMode.Off:
            return { text: input, xml: "", };

        case MumeXmlMode.Desirable:
            let xmlStart = input.indexOf( "<xml>", 0 );

            // If somehow XML doesn't get enabled right after we asked for it, at
            // least the xmlDesirableBytes will reduce the window during which
            // someone might send us a fake <xml> tag and confuse the parser, which
            // would be dangerous in the middle of PK for example.
            if ( xmlStart !== -1 && this.xmlDesirableBytes + xmlStart < 1024 )
            {
                console.log( "Enabled MUME XML mode" );
                this.mode = MumeXmlMode.On;
                return { text: input.substr( 0, xmlStart ), xml: input.substr( xmlStart ), };
            }

            if ( this.xmlDesirableBytes >= 1024 )
                this.mode = MumeXmlMode.Off;

            this.xmlDesirableBytes += input.length;

            return { text: input, xml: "", };

        case MumeXmlMode.On:
            return { text: "", xml: input, };
        }
    }

    private topTag(): MumeXmlParserTag | null
    {
        if ( this.tagStack.length == 0 )
            return null;
        else
            return this.tagStack[ this.tagStack.length - 1 ];
    }

    // True if the current input is wrapped in <gratuitous>, ie. something for
    // the benefit of the client but that the player doesn't want to see.
    private isGratuitous(): boolean
    {
        for ( let tag of this.tagStack )
            if ( tag.name === "gratuitous" )
                return true;

        return false;
    }

    private resetPlainText(): string
    {
        let plainText = this.plainText;
        this.plainText = "";

        return plainText;
    }

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
        let decodedText = text
            .replace( /&lt;/g, "<" )
            .replace( /&gt;/g, ">" )
            .replace( /&amp;/g, "&" );

        return decodedText;
    }

    /* Takes text with pseudo-XML as input, returns plain text and emits events.
     */
    public filterInputText( rawInput: string ): string
    {
        if ( this.mode === MumeXmlMode.Off )
            return rawInput;

        let input = this.detectXml( rawInput );
        let matched: boolean = false;
        let matches: RegExpExecArray | null;

        while ( ( matches = MumeXmlParser.TAG_RE.exec( input.xml ) ) !== null )
        {
            let textBefore, isEnd, tagName, attr, isLeaf, textAfter;
            [ , textBefore, isEnd, tagName, attr, isLeaf, textAfter ] = matches;

            matched = true;

            if ( textBefore )
                this.pushText( textBefore );

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
                this.pushText( textAfter );
        }

        if ( ! matched )
            this.pushText( input.xml );

        return input.text + this.resetPlainText();
    }

    private pushText( raw: string ): void
    {
        let text = MumeXmlParser.decodeEntities( raw );
        let topTag = this.topTag();

        this.scouting.pushText( text );

        if ( !topTag || topTag.name === "xml" )
        {
            this.plainText += text;
        }
        else
        {
            if ( topTag.text.length + text.length > 1500 )
            {
                console.warn( "Run-away MumeXmlParser tag " +
                    topTag.name + ", force-closing the tag." );
                this.tagStack.pop();
            }

            if ( !this.isGratuitous() )
                this.plainText += text;

            topTag.text += text;
        }
    }

    private startTag( tagName: string, attr: string ): void
    {
        if ( this.tagStack.length > 5 )
        {
            let tags = this.tagStack.map( t => t.name ).join();
            console.warn( `Ignoring MumeXmlParser tag ${tagName} because of deeply nested tags: ${tags}` );
            return;
        }

        this.tagStack.push( { name: tagName, attr: attr, text: "" } );
    }

    private endTag( tagName: string ): void
    {
        if ( tagName === "xml" )
        {
            // Most likely, the player typed "cha xml" by mistake. Hopefully he'll
            // reenable it soon, otherwise we prefer to break rather than remain
            // wide open to attack.
            this.setXmlModeDesirable();
        }

        // Find the most recent tag in the stack which matches tagName
        let matchingTagIndex: number | null = null;
        for ( let i = this.tagStack.length - 1; i >= 0; --i )
        {
            if ( this.tagStack[i].name === tagName )
            {
                matchingTagIndex = i;
                break;
            }
        }

        // Perform some sanity checks
        if ( matchingTagIndex == null )
        {
            console.warn( "Ignoring unmatched closing MumeXmlParser tag " + tagName );
            return;
        }
        else if ( matchingTagIndex + 1 !== this.tagStack.length )
        {
            let tags = this.tagStack.slice( matchingTagIndex + 1 ).map( t => t.name ).join();
            console.warn( "Closing MumeXmlParser tag " + tagName +
                " with the following other tags open: " + tags );
            this.tagStack.length = matchingTagIndex + 1;

            // fall through
        }

        let topTag = <MumeXmlParserTag>this.tagStack.pop();
        this.scouting.endTag( topTag );
        if ( !this.scouting.active )
            $(this).triggerHandler( MumeXmlParser.SIG_TAG_END, [ topTag, ] );
    }
}

} // ns
