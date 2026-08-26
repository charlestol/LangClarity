export const APP_NAME = 'LangClarity';

export function formatLabel(value: string): string {
	return `${APP_NAME}: ${value}`;
}

export type LabelOptions = {
	uppercase?: boolean;
};
