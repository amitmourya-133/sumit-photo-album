const { handleUpload } = require('@vercel/blob/client');

module.exports = async (req, res) => {
  try {
    const body = req.body;
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        return {
          allowedContentTypes: ['image/*', 'audio/*'],
          addRandomSuffix: true,
          maximumSizeInBytes: 100 * 1024 * 1024,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // completed
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (error) {
    console.error('token error');
    return res.status(400).json({ error: error.message || 'token generation failed' });
  }
};