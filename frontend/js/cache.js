/**
 * @namespace qtoggle.cache
 */

import Logger from '$qui/lib/logger.module.js'

import ConditionVariable from '$qui/base/condition-variable.js'
import {AssertionError}  from '$qui/base/errors.js'
import {gettext}         from '$qui/base/i18n.js'
import Config            from '$qui/config.js'
import * as Toast        from '$qui/messages/toast.js'
import {asap}            from '$qui/utils/misc.js'
import * as ObjectUtils  from '$qui/utils/object.js'
import * as PromiseUtils from '$qui/utils/promise.js'

import * as API                   from '$app/api.js'
import {getGlobalProgressMessage} from '$app/common/common.js'


const logger = Logger.get('qtoggle.cache')


/* Registered slave devices, indexed by name */
let slaveDevices = null

/* Registered ports, indexed by full id */
let allPorts = null

/* Main device attributes */
let mainDevice = null

/* User preferences */
let prefs = null
let pendingSavePrefsTimeoutHandle = null

/* Indicates that cache needs a reload asap */
let reloadNeeded = true

/* Some ready condition variables */

/**
 * Wait for the cached device attributes to be loaded.
 * {@link qtoggle.cache.getMainDevice} can be safely called afterwards.
 * @alias qtoggle.cache.whenDeviceCacheReady
 * @type {qui.base.ConditionVariable}
 */
export const whenDeviceCacheReady = new ConditionVariable()

/**
 * Wait for the cached port attributes to be loaded.
 * {@link qtoggle.cache.getPorts} can be safely called afterwards.
 * @alias qtoggle.cache.whenPortsCacheReady
 * @type {qui.base.ConditionVariable}
 */
export const whenPortsCacheReady = new ConditionVariable()

/**
 * Wait for the cached slave device attributes to be loaded.
 * {@link qtoggle.cache.getSlaveDevices} can be safely called afterwards.
 * @alias qtoggle.cache.whenSlaveDevicesCacheReady
 * @type {qui.base.ConditionVariable}
 */
export const whenSlaveDevicesCacheReady = new ConditionVariable()

/**
 * Wait for the cached preferences to be loaded.
 * {@link qtoggle.cache.getPrefs} can be safely called afterwards.
 * @alias qtoggle.cache.whenPrefsCacheReady
 * @type {qui.base.ConditionVariable}
 */
export const whenPrefsCacheReady = new ConditionVariable()

/**
 * Wait for the initial cached data to be loaded.
 * @alias qtoggle.cache.whenCacheReady
 * @type {qui.base.ConditionVariable}
 */
export let whenCacheReady = new ConditionVariable()


/**
 * @alias qtoggle.cache.loadDevice
 * @returns {Promise}
 */
export function loadDevice() {
    logger.debug('loading main device')

    return API.getDevice().then(function (attrs) {

        if (mainDevice == null) {
            mainDevice = attrs
            whenDeviceCacheReady.fulfill()
        }
        else {
            if (!ObjectUtils.deepEquals(mainDevice, attrs)) {
                logger.debug('main device has been updated since last server connection')
                API.fakeServerEvent('device-update', attrs)
            }
        }

        logger.debug('loaded main device')

    }).catch(function (error) {

        logger.errorStack('loading main device failed', error)
        throw error

    })
}

/**
 * @alias qtoggle.cache.loadPorts
 * @returns {Promise}
 */
export function loadPorts() {
    logger.debug('loading ports')

    return API.getPorts().then(function (ports) {

        if (allPorts == null) {
            allPorts = ObjectUtils.fromEntries(ports.map(p => [p.id, p]))
            whenPortsCacheReady.fulfill()
        }
        else {
            let newAllPorts = ObjectUtils.fromEntries(ports.map(p => [p.id, p]))
            let removedPorts = Object.values(ObjectUtils.filter(allPorts, (id, port) => !(id in newAllPorts)))
            let addedPorts = Object.values(ObjectUtils.filter(newAllPorts, (id, port) => !(id in allPorts)))

            let updatedPorts = Object.values(ObjectUtils.filter(newAllPorts, function (id, port) {
                let oldPort = allPorts[id]
                if (!oldPort) {
                    return false
                }

                /* Work on copies delete value attributes since we don't want to compare values here */
                let op = ObjectUtils.copy(oldPort)
                let p = ObjectUtils.copy(port)

                delete p.value
                delete op.value

                return !ObjectUtils.deepEquals(op, p)
            }))

            let valueChangedPorts = Object.values(ObjectUtils.filter(newAllPorts, function (id, port) {
                let oldPort = allPorts[id]
                if (!oldPort) {
                    return false
                }

                return oldPort.value !== port.value
            }))

            removedPorts.forEach(function (port) {
                logger.debug(`port ${port.id} has been removed since last server connection`)
                API.fakeServerEvent('port-remove', {id: port.id})
            })

            addedPorts.forEach(function (port) {
                logger.debug(`port ${port.id} has been added since last server connection`)
                API.fakeServerEvent('port-add', port)
            })

            updatedPorts.forEach(function (port) {
                logger.debug(`port ${port.id} has been updated since last server connection`)
                API.fakeServerEvent('port-update', port)
            })

            valueChangedPorts.forEach(function (port) {
                logger.debug(`value of port ${port.id} has changed since last server connection`)
                API.fakeServerEvent('value-change', port)
            })
        }

        logger.debug(`loaded ${ports.length} ports`)

    }).catch(function (error) {

        logger.errorStack('loading ports failed', error)

        throw error

    })
}

/**
 * @alias qtoggle.cache.loadSlaveDevices
 * @returns {Promise}
 */
export function loadSlaveDevices() {
    logger.debug('loading slave devices')

    return API.getSlaveDevices().then(function (devices) {

        if (slaveDevices == null) {
            slaveDevices = ObjectUtils.fromEntries(devices.map(d => [d.name, d]))
            whenSlaveDevicesCacheReady.fulfill()
        }
        else {
            let newDevices = ObjectUtils.fromEntries(devices.map(d => [d.name, d]))
            let removedDevices = Object.values(ObjectUtils.filter(slaveDevices, (name, d) => !(name in newDevices)))
            let addedDevices = Object.values(ObjectUtils.filter(newDevices, (name, d) => !(name in slaveDevices)))

            let updatedDevices = Object.values(ObjectUtils.filter(newDevices, function (name, device) {
                let oldDevice = slaveDevices[name]
                if (!oldDevice) {
                    return false
                }

                return !ObjectUtils.deepEquals(oldDevice, device)
            }))

            removedDevices.forEach(function (device) {
                logger.debug(`device ${device.name} has been removed since last server connection`)
                API.fakeServerEvent('slave-device-remove', {name: device.name})
            })

            addedDevices.forEach(function (device) {
                logger.debug(`device ${device.name} has been added since last server connection`)
                API.fakeServerEvent('slave-device-add', device)
            })

            updatedDevices.forEach(function (device) {
                logger.debug(`device ${device.name} has been updated since last server connection`)
                API.fakeServerEvent('slave-device-update', device)
            })
        }

        logger.debug(`loaded ${devices.length} slave devices`)

    }).catch(function (error) {

        logger.errorStack('loading slave devices failed', error)
        throw error

    })
}

/**
 * @alias qtoggle.cache.loadPrefs
 * @returns {Promise}
 */
export function loadPrefs() {
    logger.debug('loading prefs')

    return API.getPrefs().then(function (p) {

        if (prefs == null) {
            prefs = p
            whenPrefsCacheReady.fulfill()
        }
        else {
            prefs = p
        }

        logger.debug('loaded prefs')

    }).catch(function (error) {

        logger.errorStack('loading prefs failed', error)
        throw error

    })
}

/**
 * @alias qtoggle.cache.load
 * @param {Number} accessLevel
 * @param {Boolean} showModalProgress
 * @returns {Promise}
 */
export function load(accessLevel, showModalProgress) {
    let loadChain = Promise.resolve()

    let progressMessage = null
    if (showModalProgress) {
        progressMessage = getGlobalProgressMessage().show()
    }

    if (accessLevel >= API.ACCESS_LEVEL_ADMIN) {
        if (progressMessage) {
            loadChain = loadChain.then(function () {
                let msg = Config.slavesEnabled ? gettext('Loading master device...') : gettext('Loading device...')
                progressMessage.setMessage(msg)
            })
        }

        loadChain = loadChain.then(loadDevice)
    }

    if (accessLevel >= API.ACCESS_LEVEL_VIEWONLY) {
        if (progressMessage) {
            loadChain = loadChain.then(function () {
                progressMessage.setMessage(gettext('Loading ports...'))
            })
        }

        loadChain = loadChain.then(loadPorts)
    }

    if (accessLevel >= API.ACCESS_LEVEL_ADMIN && Config.slavesEnabled) {
        if (progressMessage) {
            loadChain = loadChain.then(function () {
                progressMessage.setMessage(gettext('Loading devices...'))
            })
        }

        loadChain = loadChain.then(loadSlaveDevices)
    }

    if (accessLevel >= API.ACCESS_LEVEL_VIEWONLY) {
        if (progressMessage) {
            loadChain = loadChain.then(function () {
                progressMessage.setMessage(gettext('Loading preferences...'))
            })
        }

        loadChain = loadChain.then(loadPrefs)
    }

    loadChain = loadChain.catch(function (error) {

        /* Handle any error that might have occurred during loading and retry indefinitely */

        let errorMsg = error.toString()
        let promise = PromiseUtils.later(API.SERVER_RETRY_INTERVAL * 1000)

        if (progressMessage) {
            progressMessage.setMessage(gettext('Reconnecting...'))
        }
        else {
            Toast.error(errorMsg)
        }

        return promise.then(function () {
            return load(accessLevel, showModalProgress)
        })

    })

    loadChain = loadChain.then(function () {
        if (!whenCacheReady.isFulfilled()) {
            logger.debug('cached data ready')
            whenCacheReady.fulfill()
        }

        if (progressMessage) {
            progressMessage.hide()
        }
    })

    return loadChain
}

/**
 * Update cache from event.
 * @alias qtoggle.cache.updateFromEvent
 * @param {qtoggle.api.Event} event
 */
export function updateFromEvent(event) {
    let device, port

    if (!whenCacheReady.isFulfilled()) {
        /* Ignore events while cache not ready */
        return
    }

    switch (event.type) {
        case 'slave-device-update': {
            if (event.params.name in slaveDevices) {
                slaveDevices[event.params.name] = ObjectUtils.copy(event.params, /* deep = */ true)
            }
            else {
                logger.warn(`received slave device update event for unknown device "${event.params.name}"`)
            }

            break
        }

        case 'slave-device-add': {
            if (event.params.name in slaveDevices) {
                logger.debug(`received slave device add event for already existing device "${event.params.name}"`)
            }

            slaveDevices[event.params.name] = ObjectUtils.copy(event.params, /* deep = */ true)

            break
        }

        case 'slave-device-remove': {
            device = slaveDevices[event.params.name]
            if (device) {
                delete slaveDevices[event.params.name]
            }
            else {
                logger.warn(`received slave device remove event for unknown device "${event.params.name}"`)
            }

            break
        }

        case 'value-change': {
            port = allPorts[event.params.id]
            if (port) {
                port.value = event.params.value
                if (port.value != null) {
                    port.last_sync = Math.round(new Date().getTime() / 1000)
                }
            }
            else {
                logger.warn(`received value change event for unknown port "${event.params.id}"`)
            }

            break
        }

        case 'port-update': {
            if (!(event.params.id in allPorts)) {
                logger.warn(`received port update event for unknown port "${event.params.id}"`)
            }

            allPorts[event.params.id] = ObjectUtils.copy(event.params, /* deep = */ true)

            break
        }

        case 'port-add': {
            if (event.params.id in allPorts) {
                logger.debug(`received port add event for already existing port "${event.params.id}"`)
            }

            allPorts[event.params.id] = ObjectUtils.copy(event.params, /* deep = */ true)

            break
        }

        case 'port-remove': {
            port = allPorts[event.params.id]
            if (port) {
                delete allPorts[event.params.id]
            }
            else {
                logger.warn(`received port remove event for unknown port "${event.params.id}"`)
            }

            break
        }

        case 'device-update': {
            mainDevice = event.params

            break
        }
    }
}

/**
 * Return the cached main device attributes.
 * @alias qtoggle.cache.getMainDevice
 * @returns {Object}
 */
export function getMainDevice() {
    if (!whenDeviceCacheReady.isFulfilled()) {
        throw new AssertionError('Main device accessed before cache ready')
    }

    return ObjectUtils.copy(mainDevice, /* deep = */ true)
}

/**
 * Return the cached ports.
 * @alias qtoggle.cache.getPorts
 * @param {Boolean} [asList] whether to return ports as a list or as a dictionary
 * @returns {Object|Object[]}
 */
export function getPorts(asList = false) {
    if (!whenPortsCacheReady.isFulfilled()) {
        throw new AssertionError('Ports accessed before cache ready')
    }

    if (asList) {
        return Object.values(allPorts)
    }
    else {
        return ObjectUtils.copy(allPorts)
    }
}

/**
 * Look up a cached port by id.
 * @alias qtoggle.cache.getPort
 * @param {String} id
 * @returns {?Object}
 */
export function getPort(id) {
    if (!whenPortsCacheReady.isFulfilled()) {
        throw new AssertionError('Ports accessed before cache ready')
    }

    return allPorts[id] || null
}

/**
 * Return the cached slave devices.
 * @alias qtoggle.cache.getSlaveDevices
 * @param {Boolean} [asList] whether to return devices as a list or as a dictionary
 * @returns {Object|Object[]}
 */
export function getSlaveDevices(asList = false) {
    if (!whenSlaveDevicesCacheReady.isFulfilled()) {
        throw new AssertionError('Slave devices accessed before cache ready')
    }

    if (asList) {
        return Object.values(slaveDevices)
    }
    else {
        return ObjectUtils.copy(slaveDevices)
    }
}

/**
 * Look up a cached slave device by name.
 * @alias qtoggle.cache.getSlaveDevice
 * @param {String} name
 * @returns {?Object}
 */
export function getSlaveDevice(name) {
    if (!whenDeviceCacheReady.isFulfilled()) {
        throw new AssertionError('Devices accessed before cache ready')
    }

    return slaveDevices[name] || null
}

/**
 * Return the slave device owning the port with a given id.
 * @alias qtoggle.cache.findPortSlaveDevice
 * @param {String} portId
 * @returns {?Object} the slave device, if found
 */
export function findPortSlaveDevice(portId) {
    if (!Config.slavesEnabled || slaveDevices == null) {
        return null
    }

    return ObjectUtils.findValue(slaveDevices, function (deviceName) {
        return portId.startsWith(`${deviceName}.`)
    })
}

/**
 * Tell if a given name is the name of the main device.
 * @alias qtoggle.cache.isMainDevice
 * @param {String} name
 */
export function isMainDevice(name) {
    return name === mainDevice.name
}

/**
 * Return user's preferences at given path. If no path is supplied, the root preferences object is returned.
 * @alias qtoggle.cache.getPrefs
 * @param {String} [path]
 * @param {*} [def] default value in case of missing prefs at given value
 */
export function getPrefs(path = null, def = null) {
    if (!path) {
        return prefs
    }

    function getPrefsRec(prefsObj, pathArray) {
        if (!pathArray.length) {
            return prefsObj
        }

        let next = prefsObj[pathArray[0]]
        if (next === undefined) {
            return def
        }

        return getPrefsRec(next, pathArray.slice(1))
    }

    return getPrefsRec(prefs, path.split('.'))
}

/**
 * Update user's preferences at the given path.
 * @alias qtoggle.cache.setPrefs
 * @param {String} path
 * @param {*} value
 */
export function setPrefs(path, value) {
    function setPrefsRec(prefsObj, pathArray) {
        if (pathArray.length === 1) {
            prefsObj[pathArray[0]] = value
            return
        }

        let next = prefsObj[pathArray[0]]
        if (!ObjectUtils.isObject(next)) {
            next = prefsObj[pathArray[0]] = {}
        }

        setPrefsRec(next, pathArray.slice(1))
    }

    if (!path) {
        prefs = value
    }
    else {
        setPrefsRec(prefs, path.split('.'))
    }

    if (pendingSavePrefsTimeoutHandle) {
        clearTimeout(pendingSavePrefsTimeoutHandle)
    }

    pendingSavePrefsTimeoutHandle = asap(function () {

        logger.debug('saving prefs')
        pendingSavePrefsTimeoutHandle = null

        API.putPrefs(prefs)

    })
}

/**
 * Set the *reload needed* flag, determining a {@link qtoggle.cache.load} upon next listen response.
 * @alias qtoggle.cache.setReloadNeeded
 */
export function setReloadNeeded() {
    logger.debug('cache will be reloaded asap')
    reloadNeeded = true
}

/**
 * Initialize the cache subsystem.
 * @alias qtoggle.cache.init
 */
export function init() {
    /* Reload cache upon next successful listen callback, if needed */
    API.addSyncCallbacks(
        /* beginCallback = */ null,
        /* endCallback = */ null,
        /* listenCallback = */ function (error) {

            if (!error) { /* Successful listen response */
                if (reloadNeeded) {
                    reloadNeeded = false
                    load(API.getCurrentAccessLevel(), /* showModalProgress = */ false)
                }
            }

        }
    )
}
