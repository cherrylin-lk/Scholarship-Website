import os
from .validation import require

MAX_BYTES = 5 * 1024 * 1024


class S3Storage:
    def __init__(self):
        import boto3
        self.s3 = boto3.client('s3')
        self.bucket = os.environ['DOCUMENT_BUCKET']

    def upload(self, key):
        return self.s3.generate_presigned_post(Bucket=self.bucket, Key=key,
            Fields={'Content-Type': 'application/pdf'}, Conditions=[{'Content-Type': 'application/pdf'},
            ['content-length-range', 1, MAX_BYTES]], ExpiresIn=300)

    def check(self, key):
        obj = self.s3.head_object(Bucket=self.bucket, Key=key)
        require(0 < obj['ContentLength'] <= MAX_BYTES and obj['ContentType'] == 'application/pdf', 'Invalid document.')
        require(self.s3.get_object(Bucket=self.bucket, Key=key, VersionId=obj['VersionId'], Range='bytes=0-4')['Body'].read() == b'%PDF-', 'File must be a PDF.')
        return obj['VersionId']

    def download(self, key, version_id):
        return self.s3.generate_presigned_url('get_object', Params={'Bucket': self.bucket, 'Key': key,
            'VersionId': version_id, 'ResponseContentDisposition': 'attachment; filename="scholarship.pdf"',
            'ResponseContentType': 'application/octet-stream'}, ExpiresIn=300)
