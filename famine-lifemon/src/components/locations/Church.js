import React, { useState } from 'react'

import LocationRenderer from './LocationRenderer';
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../../database/firebase';

const Church = ({ setFormData }) => {
  const [type, setType] = useState(-1);

  const options = ['Marriage', 'Divorce'];
  const MarriageID = options.indexOf('Marriage');

  const handleTypeChange = async e => {
    const value = Number(e.target.value);
    setType(value);
    const marrying = value === MarriageID;

    if (marrying) {
      // allocate a new marriage id atomically using a transaction
      const counterRef = doc(db, 'marriages', 'counter');
      let allocated = 1;
      try {
        await runTransaction(db, async (transaction) => {
          const counterSnap = await transaction.get(counterRef);
          if (!counterSnap.exists()) {
            // initialise counter and use id=1
            transaction.set(counterRef, { next: 2 });
            allocated = 1;
          } else {
            const curr = counterSnap.data().next || 1;
            allocated = curr;
            transaction.update(counterRef, { next: curr + 1 });
          }
        });
      } catch (err) {
        console.error('Failed to allocate marriage id', err);
        // fallback: use timestamp-based id
        allocated = Date.now();
      }

      setFormData({
        food: -2,
        happiness: 2,
        money: -500,
        // embed the allocated id (number) so the QR contains it
        married: allocated,
      });
    } else {
      // mark divorce explicitly so scanner can perform divorce-specific handling
      setFormData({
        happiness: -2,
        married: 'divorce',
      });
    }
  }

  const controls = [
    {
      id: 'type-select',
      label: 'Type',
      value: type,
      onChange: handleTypeChange,
      select: true,
      options: options.map((o, i) => ({ value: i, label: o })),
      sx: { width: '20em' },
      required: true,
    },
  ];

  return <LocationRenderer controls={controls} />
}
/* query in group and add 3 to the group members to prevent scan*/
export default Church;
