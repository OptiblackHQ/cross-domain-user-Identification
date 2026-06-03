module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = process.env.MIXPANEL_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'MIXPANEL_TOKEN not configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
  }

  const { event, properties = {} } = body || {};
  if (!event) {
    res.status(400).json({ error: 'Missing event name' });
    return;
  }

  const distinctId = properties.distinct_id;
  if (!distinctId) {
    res.status(400).json({ error: 'Missing distinct_id' });
    return;
  }

  const payload = [
    {
      event,
      properties: {
        ...properties,
        token,
        distinct_id: distinctId,
        time: Math.floor(Date.now() / 1000),
      },
    },
  ];

  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const url =
    'https://api.mixpanel.com/track?ip=1&data=' + encodeURIComponent(data);

  try {
    const mpRes = await fetch(url);
    const text = await mpRes.text();
    res.status(200).json({ ok: text === '1' });
  } catch (e) {
    res.status(502).json({ error: 'Mixpanel request failed' });
  }
};
