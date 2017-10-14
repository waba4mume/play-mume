declare interface DecafMUD
{
    socket: DecafMUDSocket;
}

declare interface DecafMUDSocket
{
    write( data: string ): void;
}
