import React, { useEffect, useState } from 'react';
import { Box, Collapse, Paper, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { doc } from 'firebase/firestore';
import { useDocument, useDocumentData } from 'react-firebase-hooks/firestore';

import Announcement from './Announcement';
import FinalWillVote from './FinalWillVote';
import Stats from './Stats';
import QRBlock from './QRBlock';
import Result from './Result';
import { db } from '../database/firebase';
import GroupTotal from './GroupTotal';

export default function Passport({ groupId, onGroupMissing }) {
	// Live subscription: when anyone in the group scans, every phone showing
	// this passport updates, so the whole group always sees the same score.
	const [docSnap, loading, error] = useDocument(doc(db, 'groups', String(groupId)));
	const snapshot = docSnap?.exists() ? docSnap.data() : undefined;
	// Only a server-confirmed "does not exist" counts: an offline phone can
	// report a cached miss, and must not be bounced out of its group for it.
	const confirmedMissing = !!docSnap && !docSnap.exists() && !docSnap.metadata.fromCache;
	const [showBoard, setShowBoard] = useState(false);
	const marriageId = snapshot?.married && snapshot?.marriageId ? String(snapshot.marriageId) : null;
	const [marriage] = useDocumentData(marriageId ? doc(db, 'marriages', marriageId) : null);

	if (error) console.error('Passport read failed', error);

	// The helper page can reset the game, which deletes every group. A phone
	// still pointing at a deleted group goes back to the join screen.
	useEffect(() => {
		if (confirmedMissing && onGroupMissing) onGroupMissing();
	}, [confirmedMissing, onGroupMissing]);

	const toggle = () => setShowBoard((v) => !v);

	return (
		<Stack spacing={2}>
			<Announcement />
			<FinalWillVote groupId={groupId} />
			<Stats snapshot={snapshot} loading={loading} groupId={groupId} marriage={marriage} />
			<GroupTotal teamId={groupId} mine={snapshot} />
			<QRBlock groupId={groupId} />

			<Paper elevation={3}>
				<Box
					onClick={toggle}
					role="button"
					tabIndex={0}
					aria-expanded={showBoard}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							toggle();
						}
					}}
					sx={{
						display: 'flex', alignItems: 'center', justifyContent: 'space-between',
						px: 2, py: 1.5, cursor: 'pointer', userSelect: 'none',
					}}
				>
					<Typography fontWeight="bold">LEADERBOARD</Typography>
					<ExpandMoreIcon sx={{ transition: 'transform 150ms', transform: showBoard ? 'rotate(180deg)' : 'none' }} />
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
