import * as React from 'react';

export function SaveButton(props: { disabled?: boolean; onSave: () => void }): React.JSX.Element {
	return (
		<button type="button" disabled={props.disabled === true} onClick={props.onSave}>
			Save
		</button>
	);
}
