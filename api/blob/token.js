const { handleUpload } = require('@vercel/blob/client');

module.exports = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: ['image/*', 'audio/*'],
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('blob upload completed');
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (error) {
    console.error('token generation error');
    return res.status(400).json({ error: error.message });
  }
};