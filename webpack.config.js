const path = require('path')
const webpack = require('webpack')
const env = process.env.WEBPACK_ENV

// Simply configure those 4 variables:
const JS_SOURCE_FILES = ['./index.js']
const OUTPUT_FILENAME = 'index'
const DEST_FOLDER = 'dist'
const COPYRIGHT = `
Copyright (c) 2019, Neap Pty Ltd.
All rights reserved.
This source code is licensed under the BSD-style license found in the
LICENSE file in the root directory of this source tree.`

const OUTPUT_FILE = `${OUTPUT_FILENAME}.js`
const OUTPUT_FILE_MIN = `${OUTPUT_FILENAME}.min.js`

const { plugins, outputfile, mode } = env == 'build' 
	? { 
		plugins: [
			new webpack.BannerPlugin(COPYRIGHT)
		], 
		outputfile: OUTPUT_FILE_MIN,
		mode: 'production'
	} 
	: { 
		plugins: [
			new webpack.BannerPlugin(COPYRIGHT)
		], 
		outputfile: OUTPUT_FILE,
		mode: 'development'
	} 

module.exports = {
	mode,
	entry: JS_SOURCE_FILES,
	output: {
		path: path.join(__dirname, DEST_FOLDER),
		filename: outputfile,
		libraryTarget: 'umd',
		umdNamedDefine: true
	},
	module: {
		rules: [{
			// Only run `.js` and `.jsx` files through Babel
			test: /\.m?js$/,
			exclude: /(node_modules)/,
			use: {
				loader: 'babel-loader',
				options: {
					presets: ['@babel/preset-env']
				}
			}
		}]
	},
	devtool: 'source-map',
	plugins: plugins
}