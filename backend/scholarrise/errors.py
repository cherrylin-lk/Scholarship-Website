class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Conflict(ApiError):
    def __init__(self):
        super().__init__(409, 'Record changed; reload and try again.')
