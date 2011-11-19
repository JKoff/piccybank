var _ = require('underscore');
var argv = require('optimist')
    .usage('Usage: node $0')
    .default('port', parseInt(process.env.PORT) || 80)
    .alias('p', 'port')
    .describe('p', 'Server port')
    .argv;

var async = require('async');
var everyauth = require('everyauth');
var csrf = require('express-csrf');
var express = require('express');
var formidable = require('formidable');
var fs = require('fs');

eval('var config = ' + fs.readFileSync(__dirname + '/config.js', 'utf8'));

everyauth.facebook
		.appId(config.facebook.appId)
		.appSecret(config.facebook.appSecret)
		.moduleTimeout(60000)
		.handleAuthCallbackError(function(req, res) {
			console.log('Facebook auth error');
			throw 'Facebook authentication error.';
		})
		.findOrCreateUser(function(sess, accessTok, accessTokExtra, fbUserMeta) {
			var user = {
				fbId: fbUserMeta.id,
				firstName: fbUserMeta.first_name,
				lastName: fbUserMeta.last_name
			};
			user.id = user.fbId;
			sess.user = user;
			/*mysql.query(
					'SELECT id FROM users WHERE fb_id=?;', [user.fbId],
					function(err, res, fields) {
						if (!err && res.length > 0) {
							sess.user.id = user.id = res[0].id;
						}
					});
			mysql.query(
					'INSERT IGNORE INTO users (fb_id, first_name, last_name) VALUES (?, ?, ?);',
					[user.fbId, user.firstName, user.lastName],
					function(err, info) {
						if (err) throw err;
						var id = info.insertId;
						if (id) sess.user.id = user.id = id;
					});*/
			return user;
		})
		.logoutPath('/accounts/logout')
		.handleLogout(function(req, res) {
			delete req.session.user;
			req.logout();
			res.redirect(getNextURL(req), 303);
		})
		.redirectPath('/return');

var app = express.createServer();
app.use(express.bodyParser());
app.use(express.compiler({ 'enable': ['less'] }));
app.use(express.cookieParser());
//app.use(express.logger());
app.use(express.responseTime());
app.use(express.session({ secret: '8e02353054fb1ef416f3c65eb00b7fe2' }));
// TODO(jkoff): Replace registerStatic with express.static.
app.use(csrf.check());
app.use(everyauth.middleware());

var fileCache = {};
var tmplCache = {};

// TODO(jkoff): Build and cache LESS server-side.

var mysql = require('mysql').createClient({
	host: config.mysql.host,
	user: config.mysql.username,
	password: config.mysql.password,
	database: config.mysql.database
});
var redis_global = require('redis');
var redis = redis_global.createClient(config.redis.port, config.redis.host);

function cachedLoadFileSync(path) {
	return (fileCache[path] ||
			(fileCache[path] = fs.readFileSync(__dirname + path, 'utf8')));
}
var file = cachedLoadFileSync;

process.on('exit', onExit);

registerStatic('/style/:filename');
registerStatic('/images/:filename');
registerStatic('/images/social_signin_buttons_icons/:filename');
registerStatic('/vendor/:filename');

app.get('/', function(req, res) {
	renderPage({
		title: 'Home',
		content: render('/pages/index.html', {})
	}, req, res);
});

app.get('/return', function(req, res) {
	res.redirect(getNextURL(req));
});

app.all('/accounts/login', function(req, res) {
	var next = getNextURL(req);
	renderPage({
		title: 'Log in',
		content: render('/pages/accounts/login.html', {
			csrf: csrf.token(req, res, function() {}),
			next: next
		})
	}, req, res);
	//res.redirect(next);
});

/*app.get('/songs/', function(req, res) {
	renderSongList(req, res, route, 0, '');
	function route(page) {
		if (page !== null) return '/songs/page/' + page;
		else if (page === 0) return '/songs/';
		else return null;
	}
});

app.get('/songs/page/:id', function(req, res) {
	var id = req.params.id;
	renderSongList(req, res, route, id, '');
	function route(page) {
		if (page !== null) return '/songs/page/' + page;
		else if (page === 0) return '/songs/';
		else return null;
	}
});

app.get('/songs/get/:id', function(req, res) {
	var id = req.params.id;
	if (/.mid/.test(id)) {
		var headers = { 'Content-Type': 'audio/midi' };
		fs.readFile(__dirname + '/songs/' + id, function(err, text) {
    	res.send(text, headers);
  	});
	} else if (/.sse/.test(id)) {
		var headers = { 'Content-Type': 'application/instrument-thing' };
		var filename = id.replace('.sse', '.mid');
		fs.readFile(__dirname + '/songs/' + filename, function(err, text) {
    	res.send(text, headers);
  	});
	} else {
		querySong(id);
		
		function querySong(id) {
			mysql.query(
					'SELECT * FROM songs WHERE id=? LIMIT 1',
					[id],
					function(err, res, fields) {
						if (err) throw err;
						queryTracks(res[0]);
					});
		}
		function queryTracks(song) {
			mysql.query(
					'SELECT * FROM song_tracks WHERE song_id=?',
					[song.id],
					function(err, res, fields) {
						if (err) throw err;
						song.tracks = res;
						finishSong(song);
					});
		}
		function finishSong(song) {
			renderPage({
				title: song.title,
				content: render('/pages/songs/get.html', {
					song: song
				})
			}, req, res);
		}
	}
});

*/app.get('/new', function(req, res) {
	if (!requireAuth(req, res)) return;
	renderPage({
		title: 'Submit a new song!',
		content: render('/pages/new.html', {
			csrf: csrf.token(req, res, function() {})
		})
	}, req, res);
});

app.post('/new', function(req, res) {
	if (!requireAuth(req, res)) return;
	var form = formidable.IncomingForm();
	form.parse(req, function(err, fields, files) {
		mysql.query(
				'INSERT INTO images (userid, caption) VALUES (?, ?);',
				[req.session.user.id, fields.caption],
				function(err, info) {
					if (err) throw err;
					var id = info.insertId;
					var ext = /.*\.(.+)/.exec(files.upload.name)[1] || 'jpg';
					mv(files.upload.path, 'uploaded-images/' + id + '.'+ext, function() {
						/*redis.publish('uploaded-midis', id, function(a, receivers) {
							if (receivers < 1) {
								redis.sadd('uploaded-midis', id);
							}
						});*/  // redis.publish
					});  // mv
					res.redirect('/' + id);
				});  // mysql cb
	});  // form.parse
});/*

app.get('/songs/search', function(req, res) {
	var terms = req.param('terms');
	renderSongList(req, res, route, 0, getWhereClausesForSearch(terms));
	function route(page) {
		if (page !== null) return '/songs/search/page/' + page + '?terms=' + terms;
		else if (page === 0) return '/songs/search' + '?terms=' + terms;
		else return null;
	}
});
app.get('/songs/search/page/:page', function(req, res) {
	var page = req.params.page;
	var terms = req.param('terms');
	renderSongList(req, res, route, page, getWhereClausesForSearch(terms));
	function route(page) {
		if (page !== null) return '/songs/search/page/' + page + '?terms=' + terms;
		else if (page === 0) return '/songs/search' + '?terms=' + terms;
		else return null;
	}
});

function getWhereClausesForSearch(terms) {
	return {
		' OR title LIKE ': '%' + terms + '%',
		' OR artist LIKE ': '%' + terms + '%',
		' OR note LIKE ': '%' + terms + '%'
	};
}
function renderSongList(req, res, route, page, extra_mysql) {
	page = parseInt(page);
	var page_size = config.other.song_page_size;
	var mysql_args = [];
	var extra_mysql_str = '';
	if (!extra_mysql || extra_mysql.length == 0) extra_mysql_str = " 1=1 ";
	else extra_mysql_str = " 1=2 ";
	for (var k in extra_mysql) {
		extra_mysql_str += k + '?';
		mysql_args.push(extra_mysql[k]);
	}
	var query =
			'SELECT ' +
					' s.id AS id, ' +
					' s.title AS title, ' +
					' s.artist AS artist, ' +
					' CONCAT(u.first_name,\' \',u.last_name) AS ownerName ' +
				' FROM songs AS s ' +
				' LEFT JOIN users as u ' +
				' ON s.owner=u.id ' +
				' WHERE ' +
				' ' + extra_mysql_str + ' ' +
				' ORDER BY s.title ' +
				' LIMIT ' + (page_size + 1) +
				' OFFSET ' + (page * page_size);
	console.log(query);
	mysql.query(query, mysql_args, function(err, res, fields) {
		if (err) throw err;
		finish(res);
	});
	function finish(songs) {
		var prev_pg = (page > 0 ? page - 1 : null);
		var next_pg = (songs.length > page_size ? page + 1 : null);
		renderPage({
			title: 'List of songs',
			content: render('/pages/songs/list.html', {
				prev_page: route(prev_pg),
				next_page: route(next_pg),
				songs: songs.length > page_size ? (songs.pop() && songs) : songs
			})
		}, req, res);
	}
}*/

everyauth.helpExpress(app);

app.listen(argv.port);

function onExit() {
	redis.end();
}

// Directories contain :filename
function registerStatic(route) {
	app.get(route, function(req,res) {
		var filename = req.params.filename || '';
		var path = route.replace(':filename', filename);
		/*var headers = {};
		if (/\.js$/.test(path)) headers['Content-Type'] = 'application/javascript';
		else if (/\.css$/.test(path)) headers['Content-Type'] = 'text/css';
		else if (/\.png$/.test(path)) headers['Content-Type'] = 'image/png';
		else if (/\.gif$/.test(path)) headers['Content-Type'] = 'image/gif';*/
		//res.contentType(path);
   	//res.send(file(path));
		res.sendfile(__dirname + '/' + path);
	})
}

function mv(src, dest, next) {
	var srcFile = fs.createReadStream(src);
	var destFile = fs.createWriteStream(dest);
	srcFile.addListener('data', function(chunk) {
		destFile.write(chunk);
	});
	srcFile.addListener('close', function() {
		destFile.end();
		next();
		fs.unlink(src);
	});
}

function render(path, props) {
	var compiled = (tmplCache[path] ||
			(tmplCache[path] = _.template(file(path))));
  return compiled(props);
}

function renderPage(props, req, res) {
	function formatPageTitle(str) {
		return str + ' - Piccybank';
	}
	props.authenticated = req.loggedIn;
	props.user = req.session.user;
	if (!props.user) props.authenticated = false;
	if ('title' in props) props.pageTitle = formatPageTitle(props.title);
	props.path = req.originalUrl;

	res.end(render('/template.html', props));
}

function getNextURL(req) {
	var next = null;
	next = req.param('next') || req.session.next || '/';
	req.session.next = next;
	return next;
}
function requireAuth(req, res) {
	if (!req.loggedIn) res.redirect('/accounts/login?next=' + res.req.originalUrl);
	return req.loggedIn;
}
