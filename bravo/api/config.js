module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    token: process.env.MIXPANEL_TOKEN || '',
    otherSiteUrl: process.env.OTHER_SITE_URL || '',
  });
};
