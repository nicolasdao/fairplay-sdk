/**
 * Copyright (c) 2017-2019, Neap Pty Ltd.
 * All rights reserved.
 * 
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
*/

const co = require('co')
const { Channel, timeout, alts } = require('core-async')
const { fetch, identity } = require('../utils')

const EDIT_CONTENT_URI = 'http://localhost:3000/content/edit'
const SAVE_CONTENT_URI = 'http://localhost:3000/content/save'
const EDIT_INTERVAL = 10000 // 10 sec. Interval between the same Edit. During that interval, new edits replace the latest ones.
const EDIT_API_CALLS_INTERVAL = 2000 // 2 sec. Interval between Edit API requests.
const EDIT_INACTIVE_PERIOD = 2*60*1000 // 2 min. Period after which we consider that user is inactive.
const EVENTS = { edited:true, saved:true }

const _editedListeners = []
const _savedListeners = []

const _editActivityChan = new Channel(1,'sliding')
let _editChannels = []
const _saveChan = new Channel(1,'dropping')

const _checkForEdits = () => _editChannels
	.map(({ chan }) => {
		const value = chan.stake()
		return value ? [value,chan] : null
	})
	.filter(x => x)

// EDIT LOCAL EVENT LOOP. Limits the number of edits per seconds
co(function *() {
	while(true) {
		// 1. Unlock if an Edit activity has been logged.
		const latestActivity = yield _editActivityChan.take()
		// 2. Check if the user seems active or not. If he is, then keep checking for edits.
		const intervalSinceLastEdit = Date.now() - latestActivity
		const timeToKeepWaitingForPotentialEdits = EDIT_INACTIVE_PERIOD - intervalSinceLastEdit
		let keepCheckingForEdit = timeToKeepWaitingForPotentialEdits > 0
		// 2.1. If the user seems inactive release the memory used to track all the edits 
		if (!keepCheckingForEdit) {
			_editChannels = null
			_editChannels = []
		}
		// 2.2. If the user seems active, check for edits for a little while.
		const activeChanTimeout = keepCheckingForEdit ? timeout(timeToKeepWaitingForPotentialEdits) : null
		while(keepCheckingForEdit) {
			// Check if edits are immediately available. If not, wait until the first edit is available.
			let edits = _checkForEdits()
			const [newestEdit, newestEditChan] = edits.length == 0 
				? yield alts(_editChannels.map(({ chan }) => chan)) 
				: [] 

			if (newestEditChan) {
				// There was no edits, but we've just received a new one. Get all the possible others.
				edits = _checkForEdits()
				// If the 'newestEditChan' is not part of the latest edits, than add it.
				if (!edits.some(([,chan]) => chan == newestEditChan))
					edits.push([newestEdit, newestEditChan])
			}
			for(let i=0;i<edits.length;i++) {
				const [data] = edits[i]
				if (!data || !data.payload) 
					continue
				const options = data.options || {}
				const _editContent = options.editContent && typeof(options.editContent) == 'function' 
					? ((...args) => Promise.resolve(null).then(() => options.editContent(...args)))
					: editContent
				yield _editContent(data.payload, options)
				// Notify all the edited listeners
				_editedListeners.map(l => l(data.payload.transId))
				yield timeout(EDIT_API_CALLS_INTERVAL).take()
			}
			const [,chan] = yield alts([timeout(EDIT_INTERVAL), activeChanTimeout])
			keepCheckingForEdit = chan != activeChanTimeout
		}
	}
})

// SAVE LOCAL EVENT LOOP. Limits the number of SAVEs per seconds by waiting until the current save is finished before processing the next one
co(function *(){
	while(true) {
		const data = yield _saveChan.take()
		if (!data || !data.payload) 
			continue
		const options = data.options || {}
		const _saveContent = options.saveContent && typeof(options.saveContent) == 'function' 
			? ((...args) => Promise.resolve(null).then(() => options.saveContent(...args))) 
			: saveContent
		yield _saveContent(data.payload, data.options)
		// Notify all the edited listeners
		_savedListeners.map(l => l(data.payload.transId))
	}
})

const editContent = ({ pathname, id, content, layout }, options={}) => fetch.post({ 
	uri: options.endpointURI || EDIT_CONTENT_URI, 
	headers: { 'Content-type': 'application/json' }, 
	body: { pathname, id, content, layout }
})

const saveContent = ({ pathname, layout }, options={}) => fetch.post({ 
	uri: options.endpointURI || SAVE_CONTENT_URI, 
	headers: { 'Content-type': 'application/json' }, 
	body: { pathname, layout }
})

/**
 * Sends an edit command to the EDIT LOCAL EVENT LOOP. 
 * 
 * @param  {String}   pathname				File's pathname that should be edited.
 * @param  {String}   id					Data's ID that should be edited.
 * @param  {String}   content				Value that should be used to edit.
 * @param  {String}   layout				File's layout. Indicates whether this 'pathname' is a layout or not (empty).
 * @param  {String}   options.endpointURI	Default is defined in constant 'EDIT_CONTENT_URI'. If specified, this URI overides
 *                                       	the Edit API endpoint. Usefull for dev.
 * @param  {Function} options.editContent	Overides the default 'editContent' function. Usefull for mocking in dev. Signature:
 *                                        	({ pathname, id, content, layout }, options) => ...
 * @return {String}	  output 				Transaction ID
 */
const edit = ({ pathname, id, content, layout }, options) => {
	const transId = identity.newId()
	pathname = pathname || 'index.html'
	if (!id)
		return 

	// 1. Log latest Edit activity.
	_editActivityChan.put(Date.now())
	// 2. Check if am Edit channel already exist for this edit action. If not, create a new one and save it for 
	// 	  next time.
	id = id.replace(/\s/g,'')
	const chanId = `${pathname.toLowerCase().trim().replace(/^\//,'')}-${id}-${layout||''}`
	let editChan = _editChannels.find(({ id }) => id == chanId) || {}
	if (!editChan.id) {
		editChan.id = chanId
		editChan.chan = new Channel(1,'sliding')
		_editChannels.push(editChan)
	}
	// 3. Submit Edit
	editChan.chan.put({ payload: { pathname, id, content, layout, transId }, options })
	return transId
}
	
/**
 * Sends a save command to the SAVE LOCAL EVENT LOOP. 
 * 
 * @param  {String}   pathname				File's pathname that should be saved.
 * @param  {String}   layout				File's layout. Indicates whether this 'pathname' is a layout or not (empty).
 * @param  {String}   options.endpointURI	Default is defined in constant 'SAVE_CONTENT_URI'. If specified, this URI overides
 *                                       	the Save API endpoint. Usefull for dev.
 * @param  {Function} options.saveContent	Overides the default 'saveContent' function. Usefull for mocking in dev. Signature:
 *                                        	({ pathname, layout }, options) => ...
 * @return {String}	  output 				Transaction ID
 */
const save = ({ pathname, layout }, options) => {
	const transId = identity.newId()
	pathname = pathname || 'index.html'
	_saveChan.put({ payload: { pathname, layout, transId }, options })
	return transId
}

const addListener = (event, next) => {
	if (!event)
		throw new Error('Missing required argument \'event\'.')
	if (!next)
		throw new Error('Missing required argument \'next\'.')
	if (typeof(next) != 'function')
		throw new Error(`Wrong argument exception 'next'. 'next' must be a function (current: '${typeof(next)}').`)
	if (!EVENTS[event])
		throw new Error(`Wrong argument exception. Only supported events are 'saved' and 'edited' (current: '${event}').`)

	if (event == 'saved')
		return _savedListeners.push(next)
	if (event == 'edited')
		return _editedListeners.push(next)
}

const Service = function(options) {

	this.save = (payload) => save(payload,options)
	this.edit = (payload) => edit(payload,options)
	this.on = addListener

	return this
}

module.exports = Service





