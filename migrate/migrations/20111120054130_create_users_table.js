var create_users_table = new Migration({
	up: function() {
		this.execute('DROP TABLE IF EXISTS users;');
		this.execute(
			'CREATE TABLE users ( \
				id INT NOT NULL AUTO_INCREMENT, \
				userid VARCHAR(255) NOT NULL, \
				first_name VARCHAR(255), \
				last_name VARCHAR(255), \
				PRIMARY KEY (id), \
				UNIQUE KEY (userid) \
			) ENGINE=InnoDB;');
	},
	down: function() {
		this.drop_table('users');
	}
});