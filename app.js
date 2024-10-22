var _ = require('underscore');
var argv = require('optimist')
    .usage('Usage: node $0')
    .default('port', parseInt(process.env.PORT) || 80)
    .alias('p', 'port')
    .describe('p', 'Server port')
    .argv;

var async = require('async');
var aws = require('aws-lib');
var everyauth = require('everyauth');
var crypto = require('crypto');
var csrf = require('express-csrf');
var express = require('express');
var formidable = require('formidable');
var fs = require('fs');
var knox = require('knox');

eval('var config = ' + fs.readFileSync(__dirname + '/config.js', 'utf8'));

everyauth.facebook
		.appId(config.facebook.appId)
		.appSecret(config.facebook.appSecret)
		.moduleTimeout(60000)
		.handleAuthCallbackError(function(req, res) {
			console.log('Facebook auth error');
			//throw 'Facebook authentication error.';
		})
		.findOrCreateUser(function(sess, accessTok, accessTokExtra, fbUserMeta) {
			var user = {
				fbId: fbUserMeta.id,
				firstName: fbUserMeta.first_name,
				lastName: fbUserMeta.last_name
			};
			user.id = user.fbId;
			sess.user = user;
			try {
				mysql.query(
						'REPLACE INTO users (userid, first_name, last_name) VALUES (?, ?, ?)',
						[user.id, user.firstName, user.lastName],
						function(err, res, fields) {
							if (err) throw err;  // TODO(jkoff): Maybe see if we should handle?
						});
			} catch (e) { }
			return user;
		})
		.logoutPath('/accounts/logout')
		.handleLogout(function(req, res) {
			delete req.session.user;
			req.logout();
			res.redirect(getNextURL(req), 303);
		})
		.redirectPath('/return');
everyauth.debug = true;

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
/*var redis_global = require('redis');
var redis = redis_global.createClient(config.redis.port, config.redis.host);*/

var s3 = knox.createClient({
	key: 'AKIAJPZFNU4TKYMWNC2Q',
	secret: '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',
	bucket: 'piccybank'
});

function uncachedLoadFileSync(path) {
	return fs.readFileSync(__dirname + path, 'utf8');
}
function cachedLoadFileSync(path) {
	return (fileCache[path] ||
			(fileCache[path] = fs.readFileSync(__dirname + path, 'utf8')));
}
/* TODO(jkoff): cachedLoadFileSync */
var file = uncachedLoadFileSync;

process.on('uncaughtException', function() {});
process.on('exit', onExit);

registerStatic('/favicon.ico');
registerStatic('/style/:filename');
registerStatic('/images/:filename');
registerStatic('/images/social_signin_buttons_icons/:filename');
registerStatic('/Template/assets/css/:filename');
registerStatic('/Template/assets/images/:filename');
registerStatic('/Template/assets/images/navigation/:filename');
registerStatic('/Template/assets/fonts/:filename');
registerStatic('/Template/assets/js/:filename');
registerStatic('/vendor/:filename');

app.get('/', function(req, res) {
	renderPage({
		title: 'visualize your expenses',
		content: render('/pages/index.html', {})
	}, req, res);
});

app.get('/mobile', function(req, res) {
    res.redirect('/accounts/login?next=/new');
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

app.all('/firstsignin', function(req, res) {
	req.session.next = '/dashboard/';
	res.redirect('/auth/facebook');
});

app.get('/dashboard/by/:order', function(req, res) {
	renderItemList(req, res, route, 0, '', req.params.order);
	function route(page) {
		if (page !== null) return '/dashboard/by/:order/page/' + page;
		else if (page === 0) return '/dashboard/by/:order';
		else return null;
	}
});

app.get('/dashboard/by/:order/page/:id', function(req, res) {
	renderItemList(req, res, route, req.params.id, '', req.params.order);
	function route(page) {
		if (page !== null) return '/dashboard/by/:order/' + page;
		else if (page === 0) return '/dashboard/by/:order/';
		else return null;
	}
});

app.get('/dashboard/', function(req, res) {
	renderItemList(req, res, route, 0, '');
	function route(page) {
		if (page !== null) return '/dashboard/' + page;
		else if (page === 0) return '/dashboard/';
		else return null;
	}
});

app.get('/dashboard/:id', function(req, res) {
	var id = req.params.id;
	renderItemList(req, res, route, id, '');
	function route(page) {
		if (page !== null) return '/dashboard/' + page;
		else if (page === 0) return '/dashboard/';
		else return null;
	}
});

app.get('/new', function(req, res) {
	//if (!requireAuth(req, res)) return;
	renderPage({
		title: 'Record an item!',
		content: render('/pages/new.html', {
			csrf: csrf.token(req, res, function() {})
		})
	}, req, res);
});

app.post('/new', function(req, res) {
	if (!requireAuth(req, res)) return;
	
	var form = formidable.IncomingForm();
	var started = false;
	function processUL(err, fields, files) {
		// TODO(jkoff): This is an incorrect mutex mechanism.
		if (started) return;
		// This isn't atomic test-and-set!!
		started = true;
		var perms = "private";
		switch (fields.permissions) {
		case "private":
		case "public":
			perms = fields.permissions;
		};
		var price = null;
		try {
			price = parseFloat(/([0-9]+\.[0-9]+)/.exec(fields.price)[1]);
		} catch (e) {}
		mysql.query(
				'INSERT INTO items (userid, caption, price, permissions, base_rating)' +
						'VALUES (?, ?, ?, ?, ?);',
				[req.session.user.id, fields.caption, price, perms, fields.rating],
				function(err, info) {
					if (err) throw err;
					var id = info.insertId;
					var ext = /.*\.(.+)/.exec(files.upload.name)[1] || 'jpg';
					mysql.query('UPDATE items SET imgurl=? WHERE id=?',
											['/uploaded-images/' + id + '.'+ext, info.insertId]);
					mv(files.upload.path, 'uploaded-images/' + id + '.'+ext, function() {
						/*redis.publish('uploaded-midis', id, function(a, receivers) {
							if (receivers < 1) {
								redis.sadd('uploaded-midis', id);
							}
						});*/  // redis.publish
					});  // mv
					res.writeHead(302, {'Location':
							'/items/' + id
					});
					res.end();
					//res.redirect('/items/' + id);
				});  // mysql cb
	}  // form.parse
	form.parse(req,processUL);
	setTimeout(function(){processUL(null,req.body,req.body);},1000);
	return;
});

app.get('/rate/:id/rating/:rating', function(req, res) {
	if (!requireAuth(req, res)) return;
	
	var itemid = req.params.id;
	var rating = req.params.rating;
	queryItem(id);
	
	function queryItem(id) {
		mysql.query(
				'SELECT * FROM items WHERE id=? LIMIT 1',
				[id],
				function(err, res, fields) {
					if (err) throw err;
					finishItem(res[0]);
				});
	}
	function finishItem(item) {
		if (item.permissions === 'private') {
			// TODO(jkoff): More user-friendly auth error.
			if (req.session.user.id != item.userid) { authError(); return; }
		}
		rateItem(itemid, req.session.user.id, rating);
	}
	function rateItem(itemid, userid, rating) {
		try {
			mysql.query(
					'REPLACE INTO ratings (itemid, userid, rating) VALUES (?, ?, ?)',
					[itemid, userid, rating],
					function(err, res, fields) {
						if (err) throw err;  // TODO(jkoff): Maybe see if we should handle?
					});
		} catch (e) { }
	}
});

app.get('/items/:id', function(req, res) {
	var id = req.params.id;
	queryItem(id);
	
	function queryItem(id) {
		mysql.query(
				'SELECT i.id AS id, i.userid AS userid, i.caption AS caption, ' +
						'i.price AS price, i.location AS location, ' +
						'i.imgurl AS imgurl, i.permissions AS permissions, ' +
						'i.creation_ts AS creation_ts, i.base_rating AS base_rating, ' +
						'AVG(r.rating) AS avg_rating, COUNT(r.rating) AS nratings ' +
						'FROM items AS i ' +
						'LEFT JOIN ratings as r ON i.id = r.itemid AND i.userid = r.userid ' +
						'WHERE i.id=? ' +
						'GROUP BY i.id LIMIT 1',
				[id],
				function(err, res, fields) {
					if (err) throw err;
					queryRatings(res[0]);
				});
	}
	function queryRatings(item) {
		mysql.query(
				'SELECT u.first_name as first_name, u.last_name as last_name, ' +
						'u.userid as userid, r.rating as rating ' +
						'FROM ratings AS r ' +
						'LEFT JOIN users as u ON u.userid = r.userid ' +
						'WHERE r.itemid=? ' +
						'ORDER BY u.first_name',
				[item.id],
				function(err, res, fields) {
					if (err) throw err;
					finishItem(item, res);
				});
	}
	function finishItem(item, ratings) {
		if (item.permissions === 'private') {
			if (!requireAuth(req, res)) return;
			// TODO(jkoff): More user-friendly auth error.
			if (req.session.user.id != item.userid) { authError(); return; }
		}
		
		renderPage({
			caption: item.caption,
			imgurl: item.imgurl,
			title: 'Viewing ' + item.caption,
			content: render('/pages/get.html', {
				item: item,
				ratings: ratings
			})
		}, req, res);
	}
});

app.get('/uploaded-images/:file', function(req, res) {
	var file = req.params.file;
	var id = /(.*)\..*/.exec(file)[1];
	queryItem(id);
	
	function queryItem(id) {
		mysql.query(
				'SELECT * FROM items WHERE id=? LIMIT 1',
				[id],
				function(err, res, fields) {
					if (err) throw err;
					finishItem(res[0]);
				});
	}
	function finishItem(item) {
		if (item.permissions === 'private') {
			if (!requireAuth(req, res)) return;
			// TODO(jkoff): More user-friendly auth error.
			if (req.session.user.id != item.userid) { authError(); return; }
		}
		
		res.sendfile(__dirname + '/uploaded-images/' + file);
	}
});

function getWhereClausesForSearch(terms) {
	return {};
}
function renderItemList(req, res, route, page, extra_mysql, order_by) {
	//if (!requireAuth(req, res)) return;
	
	page = parseInt(page);
	var userid = '1658071309';//req.session.user.id;
	var page_size = config.other.dashboard_page_size;
	var mysql_args = [];
	var extra_mysql_str = '';
	if (order_by === undefined) order_by = 'creation_ts';
	if (!extra_mysql || extra_mysql.length == 0) extra_mysql_str = " 1=1 ";
	else extra_mysql_str = " 1=2 ";
	for (var k in extra_mysql) {
		extra_mysql_str += k + '?';
		mysql_args.push(extra_mysql[k]);
	}
	mysql_args.push(userid);
	var query =
			'SELECT ' +
					' id, ' +
					' caption, ' +
					' price, ' +
					' location, ' +
					' imgurl, ' +
					' permissions, ' +
					' creation_ts ' +
				' FROM items ' +
				' WHERE ' +
				' ' + extra_mysql_str + ' ' +
				'   AND userid = ?' +
				' ORDER BY ' + order_by + ' DESC ' +
				' LIMIT ' + (page_size + 1) +
				' OFFSET ' + (page * page_size);
	console.log(query);
	mysql.query(query, mysql_args, function(err, res, fields) {
		if (err) throw err;
		finish(res);
	});
	function finish(items) {
		var prev_pg = (page > 0 ? page - 1 : null);
		var next_pg = (items.length > page_size ? page + 1 : null);
		renderPage({
			title: 'Dashboard',
			content: render('/pages/list.html', {
				prev_page: route(prev_pg),
				next_page: route(next_pg),
				items: items.length > page_size ? (items.pop() && items) : items
			})
		}, req, res);
	}
}

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

function authError() {
	res.send('Not authorized.');
}

function render(path, props) {
	/* TODO(jkoff): uncomment */
	/*var compiled = (tmplCache[path] ||
			(tmplCache[path] = _.template(file(path))));
  return compiled(props);*/
	var compiled = _.template(file(path));
	return compiled(props);
}

function renderPage(props, req, res) {
	function formatPageTitle(str) {
		return 'piccybank - ' + str;
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
