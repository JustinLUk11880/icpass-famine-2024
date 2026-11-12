import React, { useState } from 'react';
import { Box, Collapse, Paper, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { doc } from 'firebase/firestore';
import { useDocumentData } from 'react-firebase-hooks/firestore';

import Stats from './Stats';
import QRBlock from './QRBlock';
import Result from './Result';
import { db } from '../database/firebase';

export default function Passport({ groupId }) {
	// Live subscription: when anyone in the group scans, every phone showing
	// this passport updates, so the whole group always sees the same score.
	const [snapshot, loading, error] = useDocumentData(doc(db, 'groups', String(groupId)));
	const [showBoard, setShowBoard] = useState(false);

	if (error) console.error('Passport read failed', error);

	return (
		<Stack spacing={2}>
			<Stats snapshot={snapshot} loading={loading} groupId={groupId} showCharity={false} />
			<QRBlock groupId={groupId} />

			<Paper elevation={3}>
				<Box
					onClick={() => setShowBoard((v) => !v)}
					role="button"
					tabIndex={0}
					aria-expanded={showBoard}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							setShowBoard((v) => !v);
						}
					}}
					sx={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						px: 2,
						py: 1.5,
						cursor: 'pointer',
						userSelect: 'none',
					}}
				>
					<Typography fontWeight="bold">LEADERBOARD</Typography>
					<ExpandMoreIcon
						sx={{
							transition: 'transform 150ms',
							transform: showBoard ? 'rotate(180deg)' : 'none',
						}}
					/>
				</Box>
				{/* unmountOnExit: no Firestore subscription while collapsed */}
				<Collapse in={showBoard} timeout="auto" unmountOnExit>
					<Box sx={{ px: 1, pb: 2 }}>
						<Result highlightGroup={groupId} />
					</Box>
				</Collapse>
			</Paper>
		</Stack>
	);
}
