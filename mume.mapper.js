(function () {

var loadMap, animate;

loadMap = function ()
{
    var stage = new PIXI.Stage( 0x000000 );
    var renderer = PIXI.autoDetectRenderer( 400, 300 );
    var mapWindow = window.open( "about:blank", "mume-map", "dialog,minimizable" );
    mapWindow.document.body.appendChild( renderer.view );
    var text = new PIXI.Text( "Hello World!", { fill: 'white' } );
    stage.addChild( text );
    renderer.render( stage );
}

window.addEventListener("load", loadMap);

})();
