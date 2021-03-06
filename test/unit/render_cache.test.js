var   _             = require('underscore')
    , sys           = require('util')
    , th            = require('../support/test_helper.js')
    , assert        = require('assert')
    , grainstore    = require('grainstore')
    , RenderCache   = require('../../lib/windshaft/render_cache.js')
    , redis         = require('redis')
    , serverOptions = require('../support/server_options')
    , tests         = module.exports = {};

suite('render_cache', function() {
 
    var redis_client = redis.createClient(serverOptions.redis.port);

    // initialize core mml_store
    var mml_store  = new grainstore.MMLStore(serverOptions.redis, serverOptions.grainstore);

    suiteSetup(function(done) {
      // Check that we start with an empty redis db 
      redis_client.keys("*", function(err, matches) {
          assert.equal(matches.length, 0);
          done();
      });
    });

    test('has a cache of render objects', function(){
        var render_cache = new RenderCache(100, mml_store);
        assert.ok(_.isObject(render_cache.renderers));
    });

    test('can create a unique key from request, stripping xyz/callback', function(){
        var render_cache = new RenderCache(100, mml_store);
        var req = {params: {dbname: "windshaft_test", table: 'test_table', x: 4, y:4, z:4, sql:"select *", geom_type:'point', format:'png' }};

        assert.equal(render_cache.createKey(req.params), 'windshaft_test:test_table::png:point:select *:::');
    });

    test('cache key includes style', function(){
        var render_cache = new RenderCache(100, mml_store);
        var req = {params: {dbname: "windshaft_test", table: 'test_table', x: 4, y:4, z:4, geom_type:'point', style:"#test_table{}", format:'png' }};

        assert.equal(render_cache.createKey(req.params), 'windshaft_test:test_table::png:point:::#test_table{}:');
    });

    test('cache key includes style_version', function(){
        var render_cache = new RenderCache(100, mml_store);
        var req = {params: {dbname: "windshaft_test", table: 'test_table', x: 4, y:4, z:4, geom_type:'point', style:"#test_table{}", format:'png', style_version:'2.1.0' }};

        assert.equal(render_cache.createKey(req.params), 'windshaft_test:test_table::png:point:::#test_table{}:2.1.0');
    });

    /**
     * THE FOLLOWING TESTS NEED SOME DB SETUP
     * They need a database setup as below with the table test_table defined
     */

    test('render_cache can generate a tilelive object', function(done){
        var render_cache = new RenderCache(100, mml_store);
        var req = {params: {dbname: "windshaft_test", table: 'test_table', x: 4, y:4, z:4, geom_type:'polygon', format:'png' }};

        render_cache.getRenderer(req, function(err, renderer){
            assert.ok(renderer, err);
            assert.ok(renderer.get(), err);
            assert.equal(renderer.get()._uri.query.base.split(':')[0], 'windshaft_test');
            done();
        });
    });


    test('render_cache can generate > 1 tilelive object', function(done){
        var render_cache = new RenderCache(100, mml_store);
        var req = {params: {dbname: "windshaft_test", table: 'test_table', x: 4, y:4, z:4, geom_type:'polygon', format:'png' }};

        render_cache.getRenderer(req, function(err, renderer){
            assert.ok(renderer, err);
            req = {params: {dbname: "windshaft_test", table: 'test_table_2', x: 4, y:4, z:4, geom_type:'polygon', format:'png' }};
            render_cache.getRenderer(req, function(err, renderer2){
                assert.equal(_.keys(render_cache.renderers).length, 2);
                done();
            });
        });
    });


    test('render_cache can reuse tilelive object', function(done){
        var render_cache = new RenderCache(100, mml_store);
        var req = {params: {dbname: "windshaft_test", table: 'test_table', x: 4, y:4, z:4, geom_type:'polygon', format:'png' }};

        render_cache.getRenderer(req, function(err, renderer){
            assert.ok(renderer, err);
            render_cache.getRenderer(req, function(err, renderer){
                assert.equal(_.keys(render_cache.renderers).length, 1);
                done();
            });
        });
    });

    test('render_cache can delete all tilelive objects when reset', function(done){
        var render_cache = new RenderCache(10000, mml_store);

        var req = {params: {dbname: "windshaft_test", table: 'test_table', x: 4, y:4, z:4, geom_type:'polygon', format:'png' }};
        render_cache.getRenderer(req, function(err, renderer){
            assert.ok(renderer, err);
            assert.equal(_.keys(render_cache.renderers).length, 1);

            var req = {params: {dbname: "windshaft_test", table: 'test_table', x: 4, y:4, z:4, geom_type:'polygon', format:'png',
                sql: "(SELECT * FROM test_table LIMIT 50) as q" }};
            render_cache.getRenderer(req, function(err, renderer){
                assert.equal(_.keys(render_cache.renderers).length, 2);
                render_cache.reset(req);
                assert.equal(_.keys(render_cache.renderers).length, 0);
                done();
            });
        });
    });


    test('render_cache can delete only related tilelive objects when reset', function(done){
        var render_cache = new RenderCache(100, mml_store);

        var req = {params: {dbname: "windshaft_test", table: 'test_table', x: 4, y:4, z:4, geom_type:'polygon', format:'png' }};
        render_cache.getRenderer(req, function(err, renderer){
            assert.ok(renderer, err);
            req.params.sql = "(SELECT * FROM test_table LIMIT 50) as q";

            render_cache.getRenderer(req, function(err, renderer){
                delete req.params.sql;
                req.params.table = 'test_table_2';

                render_cache.getRenderer(req, function(err, renderer){
                    assert.equal(_.keys(render_cache.renderers).length, 3);

                    req.params.table = 'test_table';
                    render_cache.reset(req);

                    assert.equal(_.keys(render_cache.renderers).length, 1);

                    done();
                });
            });
        });
    });

    // See https://github.com/Vizzuality/Windshaft/issues/59
    test('clears both auth and non-auth renderer caches on reset', function(done){
        var render_cache = new RenderCache(100, mml_store);

        var req = {params: {dbname: "windshaft_test", table: 'test_table', x: 4, y:4, z:4, geom_type:'polygon', format:'png' }};
        render_cache.getRenderer(req, function(err, renderer){
            assert.ok(renderer, err);
            req.params.dbuser = "root";

            render_cache.getRenderer(req, function(err, renderer){
                delete req.params.sql;
                req.params.table = 'test_table_2';

                render_cache.getRenderer(req, function(err, renderer){
                    assert.equal(_.keys(render_cache.renderers).length, 3);

                    req.params.table = 'test_table';
                    render_cache.reset(req);

                    assert.equal(_.keys(render_cache.renderers).length, 1, _.keys(render_cache.renderers).join('\n'));

                    done();
                });
            });
        });
    });


    test('render_cache can purge all tilelive objects', function(done){
        var render_cache = new RenderCache(2000, mml_store);

        var req = {params: {dbname: "windshaft_test", table: 'test_table', x: 4, y:4, z:4, geom_type:'polygon', format:'png' }};

        render_cache.getRenderer(req, function(err, renderer){
            assert.ok(renderer, err);
            req.params.sql = "(SELECT * FROM test_table LIMIT 50) as q";

            render_cache.getRenderer(req, function(err, renderer){
                delete req.params.sql;
                req.params.table = 'test_table_2';

                render_cache.getRenderer(req, function(err, renderer){
                    assert.equal(_.keys(render_cache.renderers).length, 3);

                    req.params.table = 'test_table';
                    render_cache.purge();

                    assert.equal(_.keys(render_cache.renderers).length, 0);

                    done();
                });
            });
        });
    });

    test('render_cache automatically deletes tilelive only after timeout', function(done){
        var render_cache = new RenderCache(100, mml_store);
        var req = {params: {dbname: "windshaft_test", table: 'test_table', x: 4, y:4, z:4, geom_type:'polygon', format:'png' }};
        render_cache.getRenderer(req, function(err, renderer){
            assert.ok(renderer, err);
            assert.equal(_.keys(render_cache.renderers).length, 1);
            setTimeout(function(){assert.equal(_.keys(render_cache.renderers).length, 0); done();},200);
        });
    });

    suiteTeardown(function(done) {
      // Flush redis cache
      // See https://github.com/Vizzuality/Windshaft/issues/24
      redis_client.flushall(done);
    });

});

