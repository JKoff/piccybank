var create_ratings_table = new Migration({
	up: function() {
		this.execute('DROP TABLE IF EXISTS ratings;');
		this.execute(
			'CREATE TABLE ratings ( \
				id INT NOT NULL AUTO_INCREMENT, \
				itemid INT NOT NULL, \
				userid VARCHAR(255) NOT NULL, \
				rating INT NOT NULL, \
				PRIMARY KEY (id), \
				UNIQUE KEY (itemid, userid) \
			) ENGINE=InnoDB;');
	},
	down: function() {
		this.drop_table('ratings');
	}
});