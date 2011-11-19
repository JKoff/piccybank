var create_items_table = new Migration({
	up: function() {
		this.execute('DROP TABLE IF EXISTS items;');
		this.execute(
			'CREATE TABLE items ( \
				id INT NOT NULL AUTO_INCREMENT, \
				userid VARCHAR(255) NOT NULL,
				caption VARCHAR(255) NOT NULL, \
				price DECIMAL(7,2), \
				location POINT, \
				creation_ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
				PRIMARY KEY (id), \
			) ENGINE=InnoDB;');
	},
	down: function() {
		this.drop_table('items');
	}
});