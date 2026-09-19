import React, { useState } from 'react'

import LocationRenderer from './LocationRenderer';
import { PrimaryLevel } from './School';

const JobCentre = ({ setFormData }) => {
    const [type, setType] = useState(-1);
    const [amount, setAmount] = useState(-1);

    const roles = ['Food Delivery', 'Cleaner'];
    const FoodDeliveryID = roles.indexOf('Food Delivery');
    const CleanerID = roles.indexOf('Cleaner');

    const handleRoleChange = e => {
        const value = Number(e.target.value);
        setType(value);
        setAmount(1);
        setFormData({
            food: -1,
            happiness: -1,
            education: { requirement: PrimaryLevel },
            money: value === FoodDeliveryID ? 70 : 0,
        });
    }

    const handleAmount = e => {
        const value = Math.min(100, Math.max(0, Number(e.target.value)));
        setAmount(value);
        setFormData({
            food: -1,
            education: { requirement: PrimaryLevel },
            money: value,
        });
    }

    const controls = [
        {
            id: 'type-select',
            label: 'Role',
            value: type,
            onChange: handleRoleChange,
            select: true,
            options: roles.map((r, i) => ({ value: i, label: r })),
            sx: { width: '20em' },
            required: true,
        },
        type === CleanerID ? {
            id: 'amount-select',
            label: 'Amount',
            value: amount,
            onChange: handleAmount,
            select: false,
            sx: { width: '20em' },
            required: true,
            type: 'number',
            inputProps: { min: 0, max: 100 },
        } : null
    ].filter(Boolean);

    return <LocationRenderer controls={controls} />
}

export default JobCentre;
