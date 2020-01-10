
import abc
import logging

from typing import Optional, Tuple

from qtoggleserver import utils
from qtoggleserver.conf import settings


STATUS_IDLE = 'idle'
STATUS_CHECKING = 'checking'
STATUS_DOWNLOADING = 'downloading'
STATUS_EXTRACTING = 'extracting'
STATUS_VALIDATING = 'validating'
STATUS_FLASHING = 'flashing'
STATUS_RESTARTING = 'restarting'
STATUS_ERROR = 'error'


logger = logging.getLogger(__name__)

_driver: Optional['BaseDriver'] = None


class FWUpdateException(Exception):
    pass


class FWUpdateDisabled(FWUpdateException):
    pass


class BaseDriver(metaclass=abc.ABCMeta):
    def __init__(self) -> None:
        pass

    @abc.abstractmethod
    async def get_current_version(self) -> str:
        pass

    @abc.abstractmethod
    async def get_latest(self) -> Tuple[str, str, str]:
        pass

    @abc.abstractmethod
    async def get_status(self) -> str:
        return STATUS_IDLE

    @abc.abstractmethod
    async def update_to_version(self, version: str) -> None:
        pass

    @abc.abstractmethod
    async def update_to_url(self, url: str) -> None:
        pass


def _get_fwupdate() -> BaseDriver:
    global _driver

    if not settings.system.fwupdate_driver:
        raise FWUpdateDisabled()

    if _driver is None:
        logger.debug('initializing fwupdate')

        cls = utils.load_attr(settings.system.fwupdate_driver)
        _driver = cls()

    return _driver


async def get_current_version() -> str:
    current_version = await _get_fwupdate().get_current_version()
    logger.debug('current version: %s', current_version)

    return current_version


async def get_latest() -> Tuple[str, str, str]:
    latest_version, latest_date, latest_url = await _get_fwupdate().get_latest()
    logger.debug('latest version: %s/%s at %s', latest_version, latest_date, latest_url)

    return latest_version, latest_date, latest_url


async def get_status() -> str:
    status = await _get_fwupdate().get_status()
    logger.debug('status: %s', status)

    return status


async def update_to_version(version: str) -> None:
    logger.debug('updating to version %s', version)

    await _get_fwupdate().update_to_version(version)


async def update_to_url(url: str) -> None:
    logger.debug('updating to url %s', url)

    await _get_fwupdate().update_to_url(url)
