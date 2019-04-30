/**
 * Copyright (c) 2017-2019, Neap Pty Ltd.
 * All rights reserved.
 * 
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
*/

const services = require('./src/services')

const Fairplay = function(options) {
	const content = new services.Content(options)

	this.content = content

	return this
}

module.exports = {
	Fairplay
}


