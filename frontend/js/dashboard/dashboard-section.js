import {gettext}  from '$qui/base/i18n.js'
import * as Toast from '$qui/messages/toast.js'

import * as API                   from '$app/api.js'
import * as Cache                 from '$app/cache.js'
import {getGlobalProgressMessage} from '$app/common/common.js'
import {Section}                  from '$app/sections.js'

import * as Dashboard from './dashboard.js'
import Group          from './group.js'

import './widgets/all-widgets/all-widgets.js'


const SECTION_ID = 'dashboard'
const SECTION_TITLE = gettext('Dashboard')

const logger = Dashboard.logger


export default class DashboardSection extends Section {

    constructor() {
        super({
            id: SECTION_ID,
            title: SECTION_TITLE,
            icon: Dashboard.WIDGET_ICON
        })

        this._whenPanelsLoaded = null
    }

    load() {
        return Cache.whenCacheReady.then(function () {

            return this.whenPanelsLoaded()

        }.bind(this))
    }

    _loadPanels() {
        logger.debug('loading panels')
        let progressMessage = getGlobalProgressMessage().show()
        progressMessage.setMessage(gettext('Loading panels...'))

        return API.getDashboardPanels().then(function (panels) {

            logger.debug('panels loaded')
            return panels

        }).catch(function (error) {

            logger.errorStack('loading panels failed', error)
            Toast.error(error.message)

            throw error

        }).finally(function () {

            progressMessage.hide()

        })
    }

    whenPanelsLoaded() {
        if (!this._whenPanelsLoaded) {
            this._whenPanelsLoaded = this._loadPanels()
        }

        return this._whenPanelsLoaded
    }

    onServerEvent(event) {
        switch (event.type) {
            case 'value-change': {
                let currentPanel = Dashboard.getCurrentPanel()

                if (currentPanel && event.params.value != null) {
                    currentPanel.getWidgets().forEach(function (widget) {
                        widget.onPortValueChange(event.params.id, event.params.value)
                    })
                }

                break
            }

            case 'port-update': {
                this._updateWidgetStates()

                break
            }

            case 'port-add': {
                this._updateWidgetStates()

                break
            }

            case 'port-remove': {
                this._updateWidgetStates()

                break
            }
        }
    }

    onAccessLevelChange(oldLevel, newLevel) {
        /* Update add-enabled flag for all groups */
        let addEnabled = newLevel >= API.ACCESS_LEVEL_ADMIN

        function updateGroupRec(group) {
            if (addEnabled) {
                group.enableAdd()
            }
            else {
                group.disableAdd()
            }

            group.getChildren().forEach(function (child) {
                if (child instanceof Group) {
                    updateGroupRec(child)
                }
            })
        }

        if (Dashboard.getRootGroup()) {
            updateGroupRec(Dashboard.getRootGroup())
        }

        /* Update widget editable/protected state */
        this._updateWidgetStates()
    }

    _updateWidgetStates() {
        let currentPanel = Dashboard.getCurrentPanel()
        if (!currentPanel) {
            return
        }

        currentPanel.getWidgets().forEach(function (widget) {
            widget.updateState()
        })
    }

    makeMainPage() {
        let rootGroup = new Group({
            name: gettext('Panels')
        })

        Dashboard.setRootGroup(rootGroup)

        Cache.whenCacheReady.then(function () {

            return this.whenPanelsLoaded()

        }.bind(this)).then(function (panels) {

            rootGroup.fromJSON({children: panels})
            rootGroup.updateUI(/* recursive = */ true)

        })

        return rootGroup
    }

}
