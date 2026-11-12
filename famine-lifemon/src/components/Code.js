import * as React from 'react';

import Paper from '@mui/material/Paper';
import QRCode from 'react-qr-code';
import { sign } from 'jsonwebtoken';
import { secret } from './secret/Secret';

// Renders a signed QR code for a payload built by game/engine.js buildPayload.
export default function Code({ payload }) {
	const token = sign(payload, secret, { noTimestamp: true });
	return (
		<Paper className="qrcode" align="center" elevation={5}>
			<QRCode bgColor="white" value={token} size={256} style={{ maxWidth: '100%', height: 'auto' }} />
		</Paper>
	);
}
